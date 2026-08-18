import { createHash } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Coordinates } from '@tripick/types';
import { KAKAO_CATEGORY_CODES, KakaoLocalService } from './kakao-local.service';
import { IngestCursorRepository } from './ingest-cursor.repository';
import { PlaceEmbeddingRepository } from './place-embedding.repository';
import { TextEmbeddingService } from '../../embedding/text-embedding.service';
import { KtoCallBudget, TourApiService } from './tour-api.service';
import { PopularPlaceService } from './popular-place.service';
import { isSeoBusinessName } from './place-name-quality';
import { isEligibleItineraryCandidate } from './place-eligibility';
import { SAME_PLACE_RADIUS_M, metersBetween, normalizeCatalogName } from './near-duplicate';
import { inferPlaceTags, parseSigungu } from './place-seeds';
import { SIDO_CODES, placeRegionCodes } from './region-code';
import type { IngestPlace, IngestRegionResult, IngestSource, IngestSummary } from './ingestion.types';

export interface IngestOptions {
  /** 특정 시도명만 적재 (예: '서울'). 미지정 시 전국 시도. */
  regions?: string[];
  /** 적재 소스 선택. 기본 두 소스 모두. */
  sources?: IngestSource[];
  /** 소스별 시도당 최대 수집 건수. */
  maxPerRegion?: number;
  /**
   * 적재 전 해당 지역의 기존 벡터를 삭제한다.
   * 임베딩 모델 서버를 전환했을 때 place 벡터를 새 공간으로 재생성하기 위해 사용.
   */
  reseed?: boolean;
  /**
   * 임베딩 서버가 없어 해시 폴백이 감지돼도 적재를 강행한다.
   * 기본은 false — 해시 벡터가 실제 벡터와 섞여 검색 품질을 해치는 것을 막기 위해 중단한다.
   */
  allowHash?: boolean;
  /**
   * append 모드: 지역·소스별 페이지 커서를 이어받아 매 실행 다른 페이지를 적재한다.
   * 크론 등으로 반복 실행하면 이전에 안 읽은 새 장소가 계속 누적된다.
   * (미지정 시 항상 page 1 부터 → 같은 상위 N개만 재확인되고 신규는 안 늘어남)
   */
  append?: boolean;
}

/**
 * 카카오 로컬 + 관광공사 장소를 수집→정규화→dedupe→임베딩→place_embeddings 적재하는 오케스트레이터.
 * CLI 스크립트(ingest-places.ts) 에서 호출한다.
 */
@Injectable()
export class PlaceIngestionService {
  private readonly logger = new Logger(PlaceIngestionService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly tourApi: TourApiService,
    private readonly kakaoLocal: KakaoLocalService,
    private readonly popularPlaces: PopularPlaceService,
    private readonly embeddings: TextEmbeddingService,
    private readonly repository: PlaceEmbeddingRepository,
    private readonly cursors: IngestCursorRepository,
  ) {}

  async ingest(options: IngestOptions = {}): Promise<IngestSummary> {
    const sources = options.sources ?? ['tour', 'kakao'];
    const maxPerRegion = options.maxPerRegion ?? 100;
    const allowHash = options.allowHash ?? false;

    // 안전장치: 적재 전 임베딩 서버가 실제 벡터를 주는지 확인. 해시 폴백이면 중단.
    await this.assertEmbeddingServerReady(allowHash);
    // popular 은 네이버 코퍼스 없이는 전 지역에서 0건이 된다. 조용히 헛도는 대신 앞에서 막는다.
    if (sources.includes('popular') && !this.popularPlaces.isAvailable) {
      throw new Error(
        'popular 소스는 네이버 검색 키가 필요합니다. NAVER_SEARCH_CLIENT_ID / _SECRET 를 설정하거나 --sources 에서 popular 를 빼세요.',
      );
    }

    const sidos = await this.resolveTargetSidos(sources);

    const targets = options.regions?.length
      ? this.resolveRequestedTargets(sidos, options.regions, sources)
      : sidos;

    if (targets.length === 0 && options.regions?.length) {
      this.logger.warn(`요청한 지역(${options.regions.join(', ')})으로 적재할 대상이 없습니다.`);
    }

    const reseed = options.reseed ?? false;
    if (reseed) {
      this.logger.warn('reseed 모드: 적재 전 대상 지역의 기존 place 벡터를 삭제합니다.');
    }
    const append = options.append ?? false;
    if (append) {
      this.logger.log('append 모드: 지역별 페이지 커서를 이어받아 새 페이지부터 적재합니다.');
      if (sources.includes('popular')) {
        // popular 은 페이지가 아니라 추천 글 코퍼스를 보므로 이어받을 커서가 없다.
        // 매 실행 같은 상위 장소를 다시 확인하지만 텍스트 해시가 같아 재임베딩 없이 unchanged 다.
        this.logger.log('popular 은 append 대상이 아닙니다 (코퍼스 기반, 페이지 커서 없음).');
      }
    }

    // 실행 1회의 KTO 호출 예산. 소진되면 이후 지역의 KTO 수집을 멈춰 일일 한도를 지킨다.
    const budget = this.tourApi.createCallBudget();
    const regions: IngestRegionResult[] = [];
    for (const sido of targets) {
      regions.push(
        await this.ingestRegion(sido.code, sido.name, sources, maxPerRegion, reseed, allowHash, append, budget),
      );
      if (budget.isExhausted) {
        this.logger.warn(
          `KTO 호출량 예산 소진 — 남은 지역 적재를 중단합니다. --append 로 다음 실행에 이어받으세요.`,
        );
        break;
      }
    }

    const summary: IngestSummary = {
      regions,
      totalFetched: regions.reduce((sum, r) => sum + r.fetched, 0),
      totalInserted: regions.reduce((sum, r) => sum + r.inserted, 0),
      totalUpdated: regions.reduce((sum, r) => sum + r.updated, 0),
      totalUnchanged: regions.reduce((sum, r) => sum + r.unchanged, 0),
      totalDuplicates: regions.reduce((sum, r) => sum + r.duplicates, 0),
      totalDeleted: regions.reduce((sum, r) => sum + r.deleted, 0),
    };
    this.logger.log(
      `적재 완료: ${regions.length}개 지역, 수집 ${summary.totalFetched}건 → ` +
        `신규 ${summary.totalInserted} / 갱신 ${summary.totalUpdated} / 유지 ${summary.totalUnchanged} / ` +
        `중복 ${summary.totalDuplicates} (삭제 ${summary.totalDeleted})`,
    );
    return summary;
  }

  /**
   * `--regions` 로 요청한 지역을 적재 대상으로 바꾼다.
   *
   * 시도로 잡히면 그 시도를 쓴다. 안 잡히는 값('속초'·'전주')은 **시군구 단위 타깃**으로
   * 그대로 받는다 — popular 은 시도 코퍼스가 넓을수록 그 지역 대표 명소가 묻히기 때문이다
   * (실측: '강원도 여행지 추천' 코퍼스에서 설악산은 언급 8회로 129위, 상위는 시군구명과
   * 도립시설이 차지한다. 설악산 글은 '속초 여행'으로 쓰인다).
   *
   * tour 는 KTO 시도 코드(lDongRegnCd)가 있어야 하므로 시도 단위만 가능하다. 그때 **건너뛰는
   * 건 tour 소스뿐이고 타깃은 살린다** — 예전엔 타깃 자체를 버려서 기본 소스(tour,kakao)로
   * `--regions=속초` 를 주면 카카오·popular 수집까지 0건이 됐다. 시군구 타깃 적재는
   * `--sources=popular` 처럼 tour 를 빼야만 가능한 상태였다.
   */
  private resolveRequestedTargets(
    sidos: Array<{ code: string; name: string }>,
    requested: string[],
    sources: IngestSource[],
  ): Array<{ code: string; name: string }> {
    const targets: Array<{ code: string; name: string }> = [];
    const seen = new Set<string>();
    for (const raw of requested) {
      const matched = sidos.filter((s) => s.name.includes(raw));
      if (matched.length === 0) {
        const usable = sources.filter((source) => source !== 'tour');
        if (usable.length === 0) {
          this.logger.warn(
            `요청한 지역(${raw})이 KTO 시도 목록에 없고 tour 만 요청됐습니다 — 적재할 소스가 없어 건너뜁니다.`,
          );
          continue;
        }
        this.logger.log(
          `[${raw}] 시도가 아닌 지역 — 시군구 단위 타깃으로 ${usable.join('·')} 만 적재합니다(tour 는 시도 단위만 가능).`,
        );
      }
      const resolved = matched.length > 0 ? matched : [{ code: '', name: raw }];
      for (const target of resolved) {
        if (seen.has(target.name)) continue;
        seen.add(target.name);
        targets.push(target);
      }
    }
    return targets;
  }

  /**
   * 적재 대상 시도 목록. 기본은 KTO 시도 목록(areaCode 가 필요하므로 tour 소스의 정본).
   * tour 를 안 쓰는 실행(예: `--sources=popular`)은 KTO 키 없이도 돌아야 하므로
   * 목록을 못 받으면 정본 시도 코드 17개로 폴백한다 (areaCode 는 쓰이지 않는다).
   */
  private async resolveTargetSidos(
    sources: IngestSource[],
  ): Promise<Array<{ code: string; name: string }>> {
    const sidos = await this.tourApi.fetchSidoList();
    if (sidos.length > 0) return sidos;

    if (sources.includes('tour')) {
      this.logger.warn('시도 목록을 가져오지 못했습니다. KTO_API_KEY 를 확인하세요.');
      return sidos;
    }
    this.logger.log(
      'KTO 시도 목록 없이 정본 시도 코드 17개로 진행합니다 (tour 소스를 쓰지 않는 실행).',
    );
    return SIDO_CODES.map((name) => ({ code: '', name }));
  }

  private async ingestRegion(
    areaCode: string,
    region: string,
    sources: IngestSource[],
    maxPerRegion: number,
    reseed: boolean,
    allowHash: boolean,
    append: boolean,
    budget: KtoCallBudget,
  ): Promise<IngestRegionResult> {
    const deleted = reseed ? await this.repository.deleteRegion(region) : 0;
    if (deleted > 0) {
      this.logger.log(`[${region}] reseed: 기존 벡터 ${deleted}건 삭제`);
    }

    const collected: IngestPlace[] = [];

    // popular(대표 명소·맛집)을 맨 앞에 둔다. dedupe 가 먼저 온 쪽을 남기므로
    // 같은 장소가 KTO/카카오에도 있으면 네이버로 확인된 정본 쪽이 살아남는다.
    let popularPlaces: IngestPlace[] = [];
    if (sources.includes('popular')) {
      popularPlaces = await this.popularPlaces.collect(region, maxPerRegion);
      collected.push(...popularPlaces);
    }

    // 관광공사를 먼저 수집한다. 그 좌표들이 카카오 검색의 앵커가 되어
    // 소스 비중을 균형 있게(반반) 맞추고 위치 정확도를 확보한다.
    // append 모드에서 카카오도 이 배치(다른 페이지) 좌표를 따라가 새 지역을 탐색한다.
    let tourPlaces: IngestPlace[] = [];
    // 시군구 단위 타깃('속초')·KTO 목록 없는 실행은 시도 코드가 비어 있다. 빈 lDongRegnCd 로
    // 부르면 지역 필터 없는 전국 조회가 되어 타지역 장소가 이 라벨로 적재되므로 여기서 끊는다.
    if (sources.includes('tour') && !areaCode) {
      this.logger.warn(`[${region}] KTO 시도 코드가 없어 tour 수집을 건너뜁니다.`);
    } else if (sources.includes('tour')) {
      // reseed 는 항상 처음부터. append 는 커서를 이어받되 reseed 와 겹치면 처음부터.
      const startOffset = append && !reseed ? await this.cursors.getNextOffset(region, 'tour') : 0;
      const res = await this.tourApi.fetchByArea(areaCode, region, maxPerRegion, startOffset, budget);
      tourPlaces = res.places;
      collected.push(...tourPlaces);
      if (append) {
        await this.cursors.setNextOffset(region, 'tour', res.nextOffset);
        if (res.nextOffset === 0 && startOffset !== 0) {
          this.logger.log(`[${region}] tour 마지막 페이지 도달 → 커서 리셋(다음 실행은 상단부터 재확인)`);
        } else {
          this.logger.log(`[${region}] tour append: offset ${startOffset} → 다음 커서 ${res.nextOffset}`);
        }
      }
    }
    if (sources.includes('kakao')) {
      // 대표 명소 좌표도 앵커 풀에 넣는다 — 관광 중심지를 정확히 짚어 주므로 주변 탐색 질이 오른다.
      collected.push(
        ...(await this.fetchKakao(region, maxPerRegion, [...popularPlaces, ...tourPlaces])),
      );
    }

    // 자동 일정에 부적합한 장소는 소스를 가리지 않고 들어온다 — popular 관문이 막아도 카카오
    // 주변 검색이 '경주맛집' 을 실존 음식점으로 다시 주워 온다. 소스 합류 후 한 곳에서 막는다.
    //
    // **검색 게이트와 같은 함수로, 같은 입력으로 판정한다.** 예전엔 SEO 상호만 걸러서, 검색이
    // 절대 후보로 안 쓰는 행(약국·의원 등)이 적재만 되고 쌓였다 — 정리 CLI 로 걷어내도 재적재가
    // 그대로 되돌려 놨다(부산 재적재 후 13건 재유입).
    //
    // `categoryDetail` 을 함께 넘긴다 — place_embeddings 가 그 값을 저장하므로 검색 단계
    // pgvector 후보도 같은 값을 갖는다. 예전엔 저장을 안 해서 적재 게이트가 검색보다 후해지지
    // 않도록 **일부러 빼고** 판정했는데(§1786500000000-AddPlaceCategoryDetail), 그러면 소스가
    // 관광지로 준 실제 명소('부산 구 백제병원' 등록문화재)가 이름 때문에 함께 죽었다.
    const unique = this.dedupe(collected);
    const deduped = unique.filter((place) =>
      isEligibleItineraryCandidate({
        name: place.name,
        category: place.category,
        ...(place.categoryDetail ? { categoryDetail: place.categoryDetail } : {}),
        coordinates: place.coordinates,
      }),
    );
    const excluded = unique.length - deduped.length;
    if (excluded > 0) {
      const seo = unique.filter((place) => isSeoBusinessName(place.name)).length;
      this.logger.log(
        `[${region}] 자동 일정 부적합 ${excluded}건 제외` + (seo > 0 ? ` (SEO 상호 ${seo})` : ''),
      );
    }
    const model = this.embeddingModelId();

    let inserted = 0;
    let updated = 0;
    let unchanged = 0;
    let duplicates = 0;
    // 재임베딩 없이 영업시간만 채운 건수 (해시가 같아 unchanged 로 분류된 기존 행)
    let openingHoursFilled = 0;
    let eventPeriodsFilled = 0;
    let categoryDetailsFilled = 0;
    for (const place of deduped) {
      const text = this.buildText(place);
      const textHash = createHash('sha256').update(text).digest('hex');
      const existing = await this.repository.findProvenance({
        kakaoPlaceId: place.kakaoPlaceId ?? null,
        tourismApiId: place.tourismApiId ?? null,
        region: place.region,
        name: place.name,
      });

      if (!existing) {
        // ID 로는 못 찾았지만 같은 장소가 다른 소스 ID 로 이미 있을 수 있다(KTO 가 넣은 곳을
        // 다음 실행의 카카오가 다시 주워 오는 경로). 새 행을 만들지 않고 건너뛴다.
        //
        // 왜 **갱신이 아니라 건너뛰기**인가 — 한 장소의 KTO 표현과 카카오 표현은 카테고리 상세·
        // 주소 표기가 달라 텍스트가 다르다. 기존 행에 덮어쓰면 실행마다 두 소스가 같은 행의
        // 텍스트를 번갈아 바꿔 매번 재임베딩되는 churn 이 된다. 먼저 들어온 표현을 정본으로 두면
        // 해시가 안정되고 임베딩 호출도 안 쓴다.
        const samePlace = await this.repository.findSamePlace(place.name, place.coordinates);
        if (samePlace) {
          // 영업시간만은 예외로 채운다 — 임베딩 텍스트 밖이라 재임베딩을 부르지 않고,
          // KTO 만 주는 값이라 카카오 행에 영영 안 붙는 걸 막는다(비어 있을 때만).
          if (place.openingHours && !samePlace.openingHours) {
            await this.repository.updateOpeningHours(samePlace.id, place.openingHours);
            openingHoursFilled += 1;
          }
          duplicates += 1;
          continue;
        }
      }

      // 텍스트·모델이 모두 동일하면 재임베딩 없이 유지 (증분 적재의 핵심)
      if (existing && existing.textHash === textHash && existing.embeddingModel === model) {
        // 영업시간은 임베딩 텍스트 밖이라 해시가 같아도 달라질 수 있다(신규 확보·KTO 갱신).
        // 이 행은 재임베딩 대상이 아니므로 영업시간만 따로 채운다.
        const next = place.openingHours ?? null;
        if (next !== null && next !== existing.openingHours) {
          await this.repository.updateOpeningHours(existing.id, next);
          openingHoursFilled += 1;
        }
        // 행사 기간도 같은 이유로 따로 채운다. 연례 축제는 같은 contentId 의 날짜가 매년 바뀌는데
        // 이름·주소가 그대로라 해시는 변하지 않는다 — 이 경로가 없으면 작년 날짜에 갇힌다.
        // 기간을 못 받은 이번 실행(undefined)은 저장된 값을 건드리지 않는다.
        if (
          place.eventStartDate &&
          place.eventEndDate &&
          (place.eventStartDate !== existing.eventStartDate ||
            place.eventEndDate !== existing.eventEndDate)
        ) {
          await this.repository.updateEventPeriod(
            existing.id,
            place.eventStartDate,
            place.eventEndDate,
          );
          eventPeriodsFilled += 1;
        }
        // 카테고리 상세는 컬럼을 나중에 추가해 기존 행이 NULL 이다. 임베딩 텍스트엔 이미 들어가
        // 있어 해시가 같으므로, 백필은 이 경로로만 된다(1회성 — 이후는 해시가 변화를 잡는다).
        if (place.categoryDetail && place.categoryDetail !== existing.categoryDetail) {
          await this.repository.updateCategoryDetail(existing.id, place.categoryDetail);
          categoryDetailsFilled += 1;
        }
        unchanged += 1;
        continue;
      }

      const { vector, source } = await this.embedStrict(text, allowHash);
      await this.repository.upsertPlace(
        {
          kakaoPlaceId: place.kakaoPlaceId ?? null,
          tourismApiId: place.tourismApiId ?? null,
          name: place.name,
          address: place.address,
          category: place.category,
          categoryDetail: place.categoryDetail ?? null,
          region: place.region,
          regionSigungu: place.sigungu ?? null,
          coordinates: place.coordinates,
          imageUrl: place.imageUrl ?? null,
          // 이번 실행에 영업시간이 없으면(fetch 비활성·일시 실패·해당 없음) 기존 값을 보존한다.
          // 재임베딩(update) 경로가 무조건 null 로 덮어써 저장된 영업시간을 날리던 것을 막는다.
          // insert 시엔 existing 이 없어 null → 정상. backfill(unchanged) 경로와 대칭.
          openingHours: place.openingHours ?? existing?.openingHours ?? null,
          // 행사 기간은 매 적재에 새로 받으므로 그대로 덮어쓴다 — 연례 축제는 KTO 가 같은
          // contentId 의 날짜를 갱신하고, 그 갱신이 반영돼야 다음 회차가 다시 후보로 살아난다.
          eventStartDate: place.eventStartDate ?? null,
          eventEndDate: place.eventEndDate ?? null,
          textHash,
          embeddingModel: source === 'remote' ? model : 'hash',
        },
        vector,
        existing?.id,
      );
      if (existing) updated += 1;
      else inserted += 1;
    }

    const result: IngestRegionResult = {
      region,
      fetched: collected.length,
      deduped: deduped.length,
      inserted,
      updated,
      unchanged,
      duplicates,
      deleted,
    };
    this.logger.log(
      `[${region}] 수집 ${result.fetched} → dedupe ${result.deduped} → 신규 ${inserted} / 갱신 ${updated} / 유지 ${unchanged} (삭제 ${deleted})` +
        (duplicates > 0 ? ` · 기존 장소와 중복 ${duplicates}건 건너뜀` : '') +
        (openingHoursFilled > 0 ? ` · 영업시간 backfill ${openingHoursFilled}` : '') +
        (eventPeriodsFilled > 0 ? ` · 행사기간 backfill ${eventPeriodsFilled}` : '') +
        (categoryDetailsFilled > 0 ? ` · 카테고리상세 backfill ${categoryDetailsFilled}` : ''),
    );
    return result;
  }

  /**
   * 앞선 소스(popular·관광공사) 좌표에서 뽑은 앵커들을 중심으로 카카오 카테고리 검색
   * (위치+category_group_code)을 돌려 지역 장소를 수집한다. budget(=관광공사와 동일 상한)을
   * 앵커·카테고리에 고르게 분배해 소스 비중을 반반으로 맞춘다.
   * 앵커가 하나도 없으면 지역 중심 1곳으로 폴백한다.
   */
  private async fetchKakao(
    region: string,
    budget: number,
    anchorPlaces: IngestPlace[],
  ): Promise<IngestPlace[]> {
    const radius = this.ingestRadius();
    let centers = this.deriveAnchors(anchorPlaces, this.maxAnchors());

    if (centers.length === 0) {
      const center = await this.kakaoLocal.resolveCenter(region);
      if (!center) {
        this.logger.warn(`[${region}] 카카오 앵커 좌표를 찾지 못해 카카오 수집을 건너뜁니다.`);
        return [];
      }
      this.logger.warn(
        `[${region}] 앵커 좌표가 없어 지역 중심 1곳(반경 ${radius}m)만으로 카카오 수집 — 커버리지가 제한적입니다.`,
      );
      centers = [center];
    }

    const perAnchor = Math.max(1, Math.ceil(budget / centers.length));
    const perCategory = Math.max(1, Math.ceil(perAnchor / KAKAO_CATEGORY_CODES.length));

    const collected: IngestPlace[] = [];
    const seen = new Set<string>();
    for (const center of centers) {
      if (collected.length >= budget) break;
      const candidates = await this.kakaoLocal.searchAround(center, radius, perCategory);
      for (const c of candidates) {
        if (!c.kakaoPlaceId || seen.has(c.kakaoPlaceId)) continue;
        seen.add(c.kakaoPlaceId);
        const sigungu = parseSigungu(c.address);
        collected.push({
          kakaoPlaceId: c.kakaoPlaceId,
          name: c.name,
          category: c.category,
          ...(c.categoryDetail ? { categoryDetail: c.categoryDetail } : {}),
          address: c.address,
          coordinates: c.coordinates,
          region,
          ...(sigungu ? { sigungu } : {}),
          source: 'kakao' as const,
        });
        if (collected.length >= budget) break;
      }
    }
    return collected;
  }

  /**
   * 관광공사 장소 좌표를 격자(≈0.1°, 약 10km)로 버킷팅해 밀집 순으로 앵커(버킷 중심)를 뽑는다.
   * 장소가 실제로 몰린 지역(관광 중심지)을 카카오 검색의 중심으로 삼아 시도 전역을 고르게 훑는다.
   */
  private deriveAnchors(places: IngestPlace[], maxAnchors: number): Coordinates[] {
    if (places.length === 0) return [];
    const buckets = new Map<string, { latSum: number; lngSum: number; count: number }>();
    for (const place of places) {
      const { lat, lng } = place.coordinates;
      const key = `${lat.toFixed(1)},${lng.toFixed(1)}`;
      const bucket = buckets.get(key) ?? { latSum: 0, lngSum: 0, count: 0 };
      bucket.latSum += lat;
      bucket.lngSum += lng;
      bucket.count += 1;
      buckets.set(key, bucket);
    }
    return [...buckets.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, Math.max(1, maxAnchors))
      .map((b) => ({ lat: b.latSum / b.count, lng: b.lngSum / b.count }));
  }

  private ingestRadius(): number {
    const value = Number(this.config.get<string | number>('KAKAO_INGEST_RADIUS_M', 10000));
    return Number.isFinite(value) && value > 0 ? Math.min(value, 20000) : 10000;
  }

  private maxAnchors(): number {
    const value = Number(this.config.get<string | number>('KAKAO_INGEST_MAX_ANCHORS', 8));
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 8;
  }

  /**
   * ID(kakao_place_id / tourism_api_id) 기준 중복 제거에 더해,
   * 이름+좌표(반경 {@link SAME_PLACE_RADIUS_M}) 기준 중복도 함께 제거한다.
   * → 소스가 달라(관광공사 vs 카카오) ID 가 다른 같은 물리적 장소도 하나로 합친다.
   *
   * 좌표를 소수 3자리 버킷으로 비교하던 시절엔 **DB 조회(findSamePlace)와 판정이 갈렸다** —
   * 버킷은 경계에 걸친 쌍을 놓쳐서(실측 250m 이내 동명 쌍 138개 중 68개가 버킷 밖) 같은 실행에
   * 둘 다 통과한 뒤 두 번째가 첫 번째 행을 덮어쓰는 낭비가 생긴다. 두 판정은 같은 규칙이어야 한다.
   */
  private dedupe(places: IngestPlace[]): IngestPlace[] {
    const seenIds = new Set<string>();
    const seenByName = new Map<string, Coordinates[]>();
    const result: IngestPlace[] = [];
    for (const place of places) {
      const idKey =
        (place.kakaoPlaceId && `k:${place.kakaoPlaceId}`) ||
        (place.tourismApiId && `t:${place.tourismApiId}`) ||
        '';
      if (idKey && seenIds.has(idKey)) continue;

      const nameKey = normalizeCatalogName(place.name);
      const sameName = seenByName.get(nameKey) ?? [];
      if (sameName.some((seen) => metersBetween(seen, place.coordinates) <= SAME_PLACE_RADIUS_M)) {
        continue;
      }

      if (idKey) seenIds.add(idKey);
      sameName.push(place.coordinates);
      seenByName.set(nameKey, sameName);
      result.push(place);
    }
    return result;
  }

  /** 적재 시작 전 임베딩 서버가 실제 벡터를 주는지 확인한다. 해시 폴백이면 중단. */
  private async assertEmbeddingServerReady(allowHash: boolean): Promise<void> {
    const probe = await this.embeddings.embedWithSource('임베딩 서버 헬스체크');
    if (probe.source === 'remote') {
      const expected = this.embeddings.dimensions();
      if (probe.remoteDimensions !== expected) {
        // 차원이 어긋나면 normalizeDimensions 가 조용히 패딩/절단해 검색 공간이 오염된다.
        // --allow-hash 와 무관하게(하시 폴백이 아니라 잘못된 모델 문제) 항상 중단.
        throw new Error(
          `임베딩 서버가 ${probe.remoteDimensions}차원을 반환했지만 기대 차원은 ${expected}입니다. ` +
            '엉뚱한 모델이 올라갔을 가능성이 큽니다(패딩/절단으로 검색 품질이 조용히 손상됨). ' +
            'LLM_EMBEDDING_MODEL 이 차원과 맞는지, LLM_EMBEDDING_DIMENSIONS·init.sql 의 vector(N) 이 일치하는지 확인하세요.',
        );
      }
      this.logger.log(`임베딩 서버 확인 완료 (remote embedding, ${expected}차원).`);
      return;
    }
    if (allowHash) {
      this.logger.warn(
        '임베딩 서버 미가용 — 해시 폴백으로 적재를 강행합니다(--allow-hash). 검색 품질이 낮아지고 실제 벡터와 공간이 어긋날 수 있습니다.',
      );
      return;
    }
    throw new Error(
      '임베딩 서버에 연결할 수 없어(해시 폴백 감지) 적재를 중단합니다. ' +
        '해시 벡터가 실제 벡터와 섞이면 검색 품질이 손상됩니다. ' +
        'LLM_EMBEDDING_BASE_URL / LLM_EMBEDDING_MODEL 을 확인하거나, 의도한 것이면 --allow-hash 로 재실행하세요.',
    );
  }

  /**
   * 임베딩을 만들되, 해시 폴백이 감지되면(allowHash=false) 한 번 재시도 후 중단한다.
   * 적재 도중 서버가 죽어 해시 벡터가 조용히 섞이는 것을 막는다.
   */
  private async embedStrict(
    text: string,
    allowHash: boolean,
  ): Promise<{ vector: number[]; source: 'remote' | 'hash' }> {
    const first = await this.embeddings.embedWithSource(text);
    if (first.source === 'remote' || allowHash) {
      return { vector: first.vector, source: first.source };
    }

    // 일시적 타임아웃 흡수용 1회 재시도
    const retry = await this.embeddings.embedWithSource(text);
    if (retry.source === 'remote') return { vector: retry.vector, source: retry.source };

    throw new Error(
      `적재 중 임베딩 서버 응답 실패(해시 폴백)로 중단합니다. 이미 적재된 행은 유지됩니다. ` +
        `문제 텍스트="${text.slice(0, 40)}…". 서버 복구 후 재실행(필요 시 --reseed) 하세요.`,
    );
  }

  /** provenance 에 기록할 임베딩 모델 식별자 (embedding_model 컬럼). */
  private embeddingModelId(): string {
    return this.config.get<string>('LLM_EMBEDDING_MODEL', 'text-embedding-model');
  }

  /**
   * 임베딩 대상 텍스트를 구성한다. 카테고리 상세(카카오 경로/KTO 유형명)와 지역(시도·시군구)을
   * 명시적으로 포함해 질의(destination:… taste:…)와 토큰이 겹치도록 하고 의미 신호를 강화한다.
   *
   * 지역은 수집 라벨이 아니라 **정본 코드**를 쓴다. 라벨은 그 행을 어떤 타깃으로 수집했는지에
   * 따라 달라져서('속초' vs '강원특별자치도'), 같은 장소가 실행마다 다른 텍스트 해시를 갖고
   * 매번 재임베딩됐다(증분 적재가 무력화되고 라벨이 뒤집힌다). 코드는 주소에서 파생되므로
   * 어느 타깃으로 수집해도 같다 — 해시가 안정되고 unchanged 로 떨어진다.
   */
  private buildText(place: IngestPlace): string {
    const tags = inferPlaceTags(place).join(', ');
    const { regionCode, sigunguCode } = placeRegionCodes(
      place.region,
      place.sigungu ?? null,
      place.address,
    );
    const regionLabel = [regionCode, sigunguCode].filter(Boolean).join(' ');
    return [
      place.name,
      place.categoryDetail || place.category,
      regionLabel ? `지역: ${regionLabel}` : '',
      place.address,
      tags ? `태그: ${tags}` : '',
    ]
      .filter(Boolean)
      .join(' | ');
  }
}
