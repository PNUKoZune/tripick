import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { inferPlaceTags, tasteTagsToKeywords } from './place-seeds';
import type { RawPlaceCandidate, RetrievalContext } from './types';

interface KakaoKeywordResponse {
  documents: Array<{
    id: string;
    place_name: string;
    category_name: string;
    phone: string;
    address_name: string;
    road_address_name: string;
    x: string;
    y: string;
    distance?: string;
  }>;
}

@Injectable()
export class KakaoLocalService {
  private readonly logger = new Logger(KakaoLocalService.name);

  constructor(private readonly config: ConfigService) {}

  async search(context: RetrievalContext, limit: number): Promise<RawPlaceCandidate[]> {
    const apiKey =
      this.config.get<string>('KAKAO_LOCAL_API_KEY') ??
      this.config.get<string>('KAKAO_REST_API_KEY', '');
    if (!apiKey) return [];

    const keywords = this.buildKeywords(context);
    const collected: RawPlaceCandidate[] = [];
    const seen = new Set<string>();

    for (const keyword of keywords) {
      if (collected.length >= limit) break;
      const places = await this.searchKeyword(apiKey, keyword, Math.min(10, limit));
      for (const place of places) {
        const key = place.kakaoPlaceId ?? `${place.name}:${place.address}`;
        if (seen.has(key)) continue;
        seen.add(key);
        collected.push(place);
        if (collected.length >= limit) break;
      }
    }

    return collected;
  }

  private async searchKeyword(
    apiKey: string,
    keyword: string,
    limit: number,
  ): Promise<RawPlaceCandidate[]> {
    try {
      const res = await axios.get<KakaoKeywordResponse>(
        'https://dapi.kakao.com/v2/local/search/keyword.json',
        {
          params: { query: keyword, size: limit },
          headers: { Authorization: `KakaoAK ${apiKey}` },
          timeout: 5000,
        },
      );

      return res.data.documents.flatMap((doc) => {
        const lat = Number(doc.y);
        const lng = Number(doc.x);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return [];

        const category = this.categoryFromKakao(doc.category_name);
        const place = {
          id: `kakao-${doc.id}`,
          kakaoPlaceId: doc.id,
          name: doc.place_name,
          category,
          address: doc.road_address_name || doc.address_name,
          coordinates: { lat, lng },
          ...(doc.road_address_name ? { roadAddress: doc.road_address_name } : {}),
          ...(doc.phone ? { phone: doc.phone } : {}),
        };

        return [
          {
            ...place,
            source: 'kakao' as const,
            tags: inferPlaceTags(place),
            ...(doc.distance ? { distanceM: Number(doc.distance) } : {}),
          },
        ];
      });
    } catch (error) {
      this.logger.warn(
        `Kakao Local fallback failed for "${keyword}": ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }

  private buildKeywords(context: RetrievalContext): string[] {
    const tasteKeywords = tasteTagsToKeywords(context.tasteTags).slice(0, 4);
    const triggerKeywords =
      context.trigger === 'waiting'
        ? ['근처 카페', '대기 적은 맛집', '실내 관광']
        : context.trigger === 'weather'
          ? ['실내 관광', '박물관', '카페']
          : context.trigger === 'deviation'
            ? ['근처 관광지', '근처 카페']
            : ['관광지', '맛집', '카페'];

    const keywords = [
      ...tasteKeywords.map((tag) => `${context.destination} ${tag}`),
      ...triggerKeywords.map((keyword) => `${context.destination} ${keyword}`),
      context.destination,
    ];
    return [...new Set(keywords)];
  }

  private categoryFromKakao(categoryName: string): string {
    if (categoryName.includes('카페')) return 'cafe';
    if (categoryName.includes('음식점')) return 'restaurant';
    if (categoryName.includes('숙박')) return 'accommodation';
    if (categoryName.includes('문화') || categoryName.includes('관광')) return 'attraction';
    return 'attraction';
  }
}
