import { Injectable, Logger } from '@nestjs/common';
import { KakaoLocalService } from './kakao-local.service';
import { PlaceEmbeddingRepository } from './place-embedding.repository';
import { TextEmbeddingService } from '../../embedding/text-embedding.service';
import { TourApiService } from './tour-api.service';
import { inferPlaceTags } from './place-seeds';
import type { IngestPlace, IngestRegionResult, IngestSource, IngestSummary } from './ingestion.types';
import type { RetrievalContext } from './types';

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
}

/**
 * 카카오 로컬 + 관광공사 장소를 수집→정규화→dedupe→임베딩→place_embeddings 적재하는 오케스트레이터.
 * CLI 스크립트(ingest-places.ts) 에서 호출한다.
 */
@Injectable()
export class PlaceIngestionService {
  private readonly logger = new Logger(PlaceIngestionService.name);

  constructor(
    private readonly tourApi: TourApiService,
    private readonly kakaoLocal: KakaoLocalService,
    private readonly embeddings: TextEmbeddingService,
    private readonly repository: PlaceEmbeddingRepository,
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

    const regions: IngestRegionResult[] = [];
    for (const sido of targets) {
      regions.push(
        await this.ingestRegion(sido.code, sido.name, sources, maxPerRegion, reseed, allowHash),
      );
    }

    const summary: IngestSummary = {
      regions,
      totalFetched: regions.reduce((sum, r) => sum + r.fetched, 0),
      totalInserted: regions.reduce((sum, r) => sum + r.inserted, 0),
      totalDeleted: regions.reduce((sum, r) => sum + r.deleted, 0),
    };
    this.logger.log(
      `적재 완료: ${regions.length}개 지역, 수집 ${summary.totalFetched}건 → 신규 ${summary.totalInserted}건 (삭제 ${summary.totalDeleted}건)`,
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
  ): Promise<IngestRegionResult> {
    const deleted = reseed ? await this.repository.deleteRegion(region) : 0;
    if (deleted > 0) {
      this.logger.log(`[${region}] reseed: 기존 벡터 ${deleted}건 삭제`);
    }

    const collected: IngestPlace[] = [];

    if (sources.includes('tour')) {
      collected.push(...(await this.tourApi.fetchByArea(areaCode, region, maxPerRegion)));
    }
    if (sources.includes('kakao')) {
      collected.push(...(await this.fetchKakao(region, maxPerRegion)));
    }

    const deduped = this.dedupe(collected);

    let inserted = 0;
    for (const place of deduped) {
      const embedding = await this.embedStrict(this.buildText(place), allowHash);
      const added = await this.repository.upsertPlace(
        {
          kakaoPlaceId: place.kakaoPlaceId ?? null,
          tourismApiId: place.tourismApiId ?? null,
          name: place.name,
          address: place.address,
          category: place.category,
          region: place.region,
          coordinates: place.coordinates,
        },
        embedding,
      );
      if (added) inserted += 1;
    }

    const result: IngestRegionResult = {
      region,
      fetched: collected.length,
      deduped: deduped.length,
      inserted,
      skipped: deduped.length - inserted,
      deleted,
    };
    this.logger.log(
      `[${region}] 수집 ${result.fetched} → dedupe ${result.deduped} → 신규 ${result.inserted} (skip ${result.skipped}, 삭제 ${result.deleted})`,
    );
    return result;
  }

  /** 기존 KakaoLocalService.search() 를 재사용해 지역 장소를 수집한다. */
  private async fetchKakao(region: string, maxItems: number): Promise<IngestPlace[]> {
    const context: RetrievalContext = {
      userId: 'ingestion',
      destination: region,
    };
    const candidates = await this.kakaoLocal.search(context, maxItems);
    return candidates.flatMap((c) => {
      if (!c.kakaoPlaceId) return [];
      return [
        {
          kakaoPlaceId: c.kakaoPlaceId,
          name: c.name,
          category: c.category,
          address: c.address,
          coordinates: c.coordinates,
          region,
          source: 'kakao' as const,
        },
      ];
    });
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
  private async embedStrict(text: string, allowHash: boolean): Promise<number[]> {
    const first = await this.embeddings.embedWithSource(text);
    if (first.source === 'remote' || allowHash) return first.vector;

    // 일시적 타임아웃 흡수용 1회 재시도
    const retry = await this.embeddings.embedWithSource(text);
    if (retry.source === 'remote') return retry.vector;

    throw new Error(
      `적재 중 임베딩 서버 응답 실패(해시 폴백)로 중단합니다. 이미 적재된 행은 유지됩니다. ` +
        `문제 텍스트="${text.slice(0, 40)}…". 서버 복구 후 재실행(필요 시 --reseed) 하세요.`,
    );
  }

  private buildText(place: IngestPlace): string {
    const tags = inferPlaceTags(place).join(', ');
    return [place.name, place.category, place.address, tags].filter(Boolean).join(' | ');
  }
}
