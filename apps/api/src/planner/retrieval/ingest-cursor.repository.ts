import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

/**
 * 적재 페이지 커서 저장소 (ingest_cursors).
 * append 모드에서 지역·소스별로 "다음에 읽을 페이지"를 보존해
 * 반복 실행(예: 크론)이 이전에 안 읽은 페이지부터 이어 적재하게 한다.
 */
@Injectable()
export class IngestCursorRepository {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /** 다음에 읽을 페이지 번호. 없으면 1. */
  async getNextPage(region: string, source: string): Promise<number> {
    const rows: Array<{ next_page: number | string }> = await this.dataSource.query(
      'SELECT next_page FROM ingest_cursors WHERE region = $1 AND source = $2',
      [region, source],
    );
    const n = Number(rows[0]?.next_page);
    return Number.isFinite(n) && n > 0 ? n : 1;
  }

  /** 다음 페이지 커서를 upsert 한다. */
  async setNextPage(region: string, source: string, nextPage: number): Promise<void> {
    await this.dataSource.query(
      `INSERT INTO ingest_cursors (region, source, next_page, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (region, source)
       DO UPDATE SET next_page = EXCLUDED.next_page, updated_at = NOW()`,
      [region, source, nextPage],
    );
  }
}
