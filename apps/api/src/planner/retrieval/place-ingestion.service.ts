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
      regions.push(await this.ingestRegion(sido.code, sido.name, sources, maxPerRegion, reseed));
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
      const embedding = await this.embeddings.embed(this.buildText(place));
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

  private buildText(place: IngestPlace): string {
    const tags = inferPlaceTags(place).join(', ');
    return [place.name, place.category, place.address, tags].filter(Boolean).join(' | ');
  }
}
