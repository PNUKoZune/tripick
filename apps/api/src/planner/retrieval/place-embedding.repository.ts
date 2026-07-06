import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import type { Coordinates } from '@tripick/types';
import {
  buildPlaceEmbeddingText,
  getSeedPlaces,
  inferPlaceTags,
  normalizeDestinationRegion,
} from './place-seeds';
import type { RawPlaceCandidate } from './types';

interface PlaceEmbeddingRow {
  id: string;
  kakao_place_id?: string | null;
  tourism_api_id?: string | null;
  name: string;
  address?: string | null;
  category?: string | null;
  destination_region?: string | null;
  coordinates?: Coordinates | string | null;
  similarity?: number | string | null;
}

@Injectable()
export class PlaceEmbeddingRepository {
  private readonly logger = new Logger(PlaceEmbeddingRepository.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async searchByEmbedding(
    embedding: number[],
    destination: string,
    limit: number,
  ): Promise<RawPlaceCandidate[]> {
    const region = normalizeDestinationRegion(destination);
    const destinationLike = `%${destination}%`;
    const vector = `[${embedding.join(',')}]`;

    try {
      const rows: PlaceEmbeddingRow[] = await this.dataSource.query(
        `
        SELECT id,
               kakao_place_id,
               tourism_api_id,
               name,
               address,
               category,
               destination_region,
               coordinates,
               1 - (embedding <=> $1::vector) AS similarity
        FROM place_embeddings
        WHERE embedding IS NOT NULL
          AND (
            destination_region IS NULL
            OR lower(destination_region) = $2
            OR name ILIKE $3
            OR address ILIKE $3
          )
        ORDER BY embedding <=> $1::vector
        LIMIT $4
        `,
        [vector, region, destinationLike, limit],
      );

      return rows.flatMap((row) => this.toCandidate(row));
    } catch (error) {
      this.logger.warn(
        `pgvector place search failed, retrieval will fallback: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }

  async countSeededRegion(destination: string): Promise<number> {
    const region = normalizeDestinationRegion(destination);
    try {
      const rows: Array<{ count: string }> = await this.dataSource.query(
        'SELECT COUNT(*)::text AS count FROM place_embeddings WHERE lower(destination_region) = $1',
        [region],
      );
      return Number(rows[0]?.count ?? 0);
    } catch {
      return 0;
    }
  }

  async seedRegion(
    destination: string,
    embed: (text: string) => Promise<number[]>,
  ): Promise<number> {
    const region = normalizeDestinationRegion(destination);
    const seeds = getSeedPlaces(destination);
    let inserted = 0;

    for (const place of seeds) {
      const embedding = await embed(buildPlaceEmbeddingText(place));
      const vector = `[${embedding.join(',')}]`;
      const result: Array<{ inserted: number }> = await this.dataSource.query(
        `
        INSERT INTO place_embeddings (
          kakao_place_id,
          tourism_api_id,
          name,
          address,
          category,
          destination_region,
          coordinates,
          embedding
        )
        SELECT $1, $2, $3, $4, $5, $6, $7::jsonb, $8::vector
        WHERE NOT EXISTS (
          SELECT 1
          FROM place_embeddings
          WHERE lower(destination_region) = $6
            AND name = $3
        )
        RETURNING 1 AS inserted
        `,
        [
          place.kakaoPlaceId ?? place.id,
          place.tourismApiId ?? null,
          place.name,
          place.address,
          place.category,
          region,
          JSON.stringify(place.coordinates),
          vector,
        ],
      );
      inserted += result[0]?.inserted ?? 0;
    }

    if (inserted > 0) {
      this.logger.log(`Seeded ${inserted} ${region} place embeddings for local CRAG retrieval`);
    }
    return inserted;
  }

  private toCandidate(row: PlaceEmbeddingRow): RawPlaceCandidate[] {
    const coordinates = this.parseCoordinates(row.coordinates);
    if (!coordinates) return [];

    const place = {
      id: row.id,
      ...(row.kakao_place_id ? { kakaoPlaceId: row.kakao_place_id } : {}),
      ...(row.tourism_api_id ? { tourismApiId: row.tourism_api_id } : {}),
      name: row.name,
      category: row.category ?? 'attraction',
      address: row.address ?? '',
      coordinates,
    };

    const similarity = this.numberOrUndefined(row.similarity);
    return [
      {
        ...place,
        source: 'pgvector',
        tags: inferPlaceTags(place),
        ...(row.destination_region ? { destinationRegion: row.destination_region } : {}),
        ...(similarity !== undefined ? { similarity } : {}),
      },
    ];
  }

  private parseCoordinates(value: PlaceEmbeddingRow['coordinates']): Coordinates | null {
    if (!value) return null;
    const raw = typeof value === 'string' ? JSON.parse(value) as Partial<Coordinates> : value;
    const lat = Number(raw.lat);
    const lng = Number(raw.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
  }

  private numberOrUndefined(value: number | string | null | undefined): number | undefined {
    if (value === null || value === undefined) return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
}
