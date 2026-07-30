import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

/**
 * 적재 커서 저장소 (ingest_cursors).
 * append 모드에서 지역·소스별로 "다음에 읽을 위치"를 보존해
 * 반복 실행(예: 크론)이 이전에 안 읽은 구간부터 이어 적재하게 한다.
 *
 * 단위는 페이지가 아니라 **행 오프셋**이다 — 페이지 번호는 그 실행의 배치 크기(`--max`)에
 * 묶여 있어서, 커서를 쓴 실행과 읽는 실행의 `--max` 가 다르면 같은 숫자가 다른 구간을 뜻한다
 * (page 3 이 --max=100 이면 200행부터, --max=50 이면 100행부터). 오프셋은 실행 옵션과
 * 무관하게 같은 지점을 가리킨다.
 */
@Injectable()
export class IngestCursorRepository {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /** 다음에 읽을 행 오프셋. 없으면 0(처음부터). */
  async getNextOffset(region: string, source: string): Promise<number> {
    const rows: Array<{ next_offset: number | string }> = await this.dataSource.query(
      'SELECT next_offset FROM ingest_cursors WHERE region = $1 AND source = $2',
      [region, source],
    );
    const n = Number(rows[0]?.next_offset);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  }

  /** 다음 오프셋 커서를 upsert 한다. */
  async setNextOffset(region: string, source: string, nextOffset: number): Promise<void> {
    await this.dataSource.query(
      `INSERT INTO ingest_cursors (region, source, next_offset, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (region, source)
       DO UPDATE SET next_offset = EXCLUDED.next_offset, updated_at = NOW()`,
      [region, source, Math.max(0, Math.floor(nextOffset))],
    );
  }
}
