import { createHash } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Coordinates } from '@tripick/types';
import { KAKAO_CATEGORY_CODES, KakaoLocalService } from './kakao-local.service';
import { IngestCursorRepository } from './ingest-cursor.repository';
import { PlaceEmbeddingRepository } from './place-embedding.repository';
import { TextEmbeddingService } from '../../embedding/text-embedding.service';
import { TourApiService } from './tour-api.service';
import { inferPlaceTags, parseSigungu } from './place-seeds';
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

    const sidos = await this.tourApi.fetchSidoList();
    if (sidos.length === 0) {
      this.logger.warn('시도 목록을 가져오지 못했습니다. KTO_API_KEY 를 확인하세요.');
    }

    const targets = options.regions?.length
      ? sidos.filter((s) => options.regions!.some((r) => s.name.includes(r)))
      : sidos;

    if (targets.length === 0 && options.regions?.length) {
      this.logger.warn(`요청한 지역(${options.regions.join(', ')})에 해당하는 시도가 없습니다.`);
    }

    const reseed = options.reseed ?? false;
    if (reseed) {
      this.logger.warn('reseed 모드: 적재 전 대상 지역의 기존 place 벡터를 삭제합니다.');
    }
    const append = options.append ?? false;
    if (append) {
      this.logger.log('append 모드: 지역별 페이지 커서를 이어받아 새 페이지부터 적재합니다.');
    }

    const regions: IngestRegionResult[] = [];
    for (const sido of targets) {
      regions.push(
        await this.ingestRegion(sido.code, sido.name, sources, maxPerRegion, reseed, allowHash, append),
      );
    }

    const summary: IngestSummary = {
      regions,
      totalFetched: regions.reduce((sum, r) => sum + r.fetched, 0),
      totalInserted: regions.reduce((sum, r) => sum + r.inserted, 0),
      totalUpdated: regions.reduce((sum, r) => sum + r.updated, 0),
      totalUnchanged: regions.reduce((sum, r) => sum + r.unchanged, 0),
      totalDeleted: regions.reduce((sum, r) => sum + r.deleted, 0),
    };
    this.logger.log(
      `적재 완료: ${regions.length}개 지역, 수집 ${summary.totalFetched}건 → ` +
        `신규 ${summary.totalInserted} / 갱신 ${summary.totalUpdated} / 유지 ${summary.totalUnchanged} (삭제 ${summary.totalDeleted})`,
    );
    return summary;
  }

  private async ingestRegion(
    areaCode: string,
    region: string,
    sources: IngestSource[],
    maxPerRegion: number,
    reseed: boolean,
    allowHash: boolean,
    append: boolean,
  ): Promise<IngestRegionResult> {
    const deleted = reseed ? await this.repository.deleteRegion(region) : 0;
    if (deleted > 0) {
      this.logger.log(`[${region}] reseed: 기존 벡터 ${deleted}건 삭제`);
    }

    const collected: IngestPlace[] = [];

    // 관광공사를 먼저 수집한다. 그 좌표들이 카카오 검색의 앵커가 되어
    // 소스 비중을 균형 있게(반반) 맞추고 위치 정확도를 확보한다.
    // append 모드에서 카카오도 이 배치(다른 페이지) 좌표를 따라가 새 지역을 탐색한다.
    let tourPlaces: IngestPlace[] = [];
    if (sources.includes('tour')) {
      // reseed 는 항상 처음부터. append 는 커서를 이어받되 reseed 와 겹치면 처음부터.
      const startPage = append && !reseed ? await this.cursors.getNextPage(region, 'tour') : 1;
      const res = await this.tourApi.fetchByArea(areaCode, region, maxPerRegion, startPage);
      tourPlaces = res.places;
      collected.push(...tourPlaces);
      if (append) {
        await this.cursors.setNextPage(region, 'tour', res.nextPage);
        if (res.nextPage === 1 && startPage !== 1) {
          this.logger.log(`[${region}] tour 마지막 페이지 도달 → 커서 리셋(다음 실행은 상단부터 재확인)`);
        } else {
          this.logger.log(`[${region}] tour append: page ${startPage} → 다음 커서 ${res.nextPage}`);
        }
      }
    }
    if (sources.includes('kakao')) {
      collected.push(...(await this.fetchKakao(region, maxPerRegion, tourPlaces)));
    }

    const deduped = this.dedupe(collected);
    const model = this.embeddingModelId();

    let inserted = 0;
    let updated = 0;
    let unchanged = 0;
    // 재임베딩 없이 영업시간만 채운 건수 (해시가 같아 unchanged 로 분류된 기존 행)
    let openingHoursFilled = 0;
    for (const place of deduped) {
      const text = this.buildText(place);
      const textHash = createHash('sha256').update(text).digest('hex');
      const existing = await this.repository.findProvenance({
        kakaoPlaceId: place.kakaoPlaceId ?? null,
        tourismApiId: place.tourismApiId ?? null,
        region: place.region,
        name: place.name,
      });

      // 텍스트·모델이 모두 동일하면 재임베딩 없이 유지 (증분 적재의 핵심)
      if (existing && existing.textHash === textHash && existing.embeddingModel === model) {
        // 영업시간은 임베딩 텍스트 밖이라 해시가 같아도 달라질 수 있다(신규 확보·KTO 갱신).
        // 이 행은 재임베딩 대상이 아니므로 영업시간만 따로 채운다.
        const next = place.openingHours ?? null;
        if (next !== null && next !== existing.openingHours) {
          await this.repository.updateOpeningHours(existing.id, next);
          openingHoursFilled += 1;
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
          region: place.region,
          regionSigungu: place.sigungu ?? null,
          coordinates: place.coordinates,
          imageUrl: place.imageUrl ?? null,
          openingHours: place.openingHours ?? null,
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
      deleted,
    };
    this.logger.log(
      `[${region}] 수집 ${result.fetched} → dedupe ${result.deduped} → 신규 ${inserted} / 갱신 ${updated} / 유지 ${unchanged} (삭제 ${deleted})` +
        (openingHoursFilled > 0 ? ` · 영업시간 backfill ${openingHoursFilled}` : ''),
    );
    return result;
  }

  /**
   * 관광공사 좌표에서 뽑은 앵커들을 중심으로 카카오 카테고리 검색(위치+category_group_code)을 돌려
   * 지역 장소를 수집한다. budget(=관광공사와 동일 상한)을 앵커·카테고리에 고르게 분배해
   * 소스 비중을 반반으로 맞춘다. 관광공사 좌표가 없으면 지역 중심 1곳으로 폴백한다.
   */
  private async fetchKakao(
    region: string,
    budget: number,
    tourPlaces: IngestPlace[],
  ): Promise<IngestPlace[]> {
    const radius = this.ingestRadius();
    let centers = this.deriveAnchors(tourPlaces, this.maxAnchors());

    if (centers.length === 0) {
      const center = await this.kakaoLocal.resolveCenter(region);
      if (!center) {
        this.logger.warn(`[${region}] 카카오 앵커 좌표를 찾지 못해 카카오 수집을 건너뜁니다.`);
        return [];
      }
      this.logger.warn(
        `[${region}] 관광공사 좌표가 없어 지역 중심 1곳(반경 ${radius}m)만으로 카카오 수집 — 커버리지가 제한적입니다.`,
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
   * 이름+좌표(소수3자리, ≈100m) 기준 중복도 함께 제거한다.
   * → 소스가 달라(관광공사 vs 카카오) ID 가 다른 같은 물리적 장소도 하나로 합친다.
   */
  private dedupe(places: IngestPlace[]): IngestPlace[] {
    const seenIds = new Set<string>();
    const seenGeo = new Set<string>();
    const result: IngestPlace[] = [];
    for (const place of places) {
      const idKey =
        (place.kakaoPlaceId && `k:${place.kakaoPlaceId}`) ||
        (place.tourismApiId && `t:${place.tourismApiId}`) ||
        '';
      const geoKey = `g:${this.normalizeName(place.name)}@${place.coordinates.lat.toFixed(3)},${place.coordinates.lng.toFixed(3)}`;
      if ((idKey && seenIds.has(idKey)) || seenGeo.has(geoKey)) continue;
      if (idKey) seenIds.add(idKey);
      seenGeo.add(geoKey);
      result.push(place);
    }
    return result;
  }

  private normalizeName(name: string): string {
    return name.toLowerCase().replace(/\s+/g, '');
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
   */
  private buildText(place: IngestPlace): string {
    const tags = inferPlaceTags(place).join(', ');
    const regionLabel = [place.region, place.sigungu].filter(Boolean).join(' ');
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
