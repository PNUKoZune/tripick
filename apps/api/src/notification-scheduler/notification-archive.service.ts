import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { NotificationEntity } from '../inbox/notification.entity';
import { NOTIFICATION_RETENTION_DAYS } from './notification-scheduler.constants';

/**
 * 오래된 알림 정리기.
 *
 * 인박스 알림(notifications)은 영구 보존이라 시간이 지나면 무한정 쌓인다.
 * 읽은 지 보존 기간(30일)이 지난 알림만 삭제한다 — 안 읽은 알림은 나이와 무관하게
 * 남겨, 사용자가 아직 못 본 알림을 잃지 않게 한다.
 * (친구 요청은 friends 테이블 기반 가상 row 라 여기 영향받지 않는다.)
 */
@Injectable()
export class NotificationArchiveService {
  private readonly logger = new Logger(NotificationArchiveService.name);

  constructor(
    @InjectRepository(NotificationEntity)
    private readonly notificationsRepo: Repository<NotificationEntity>,
  ) {}

  /**
   * 읽은 지 보존 기간이 지난 알림을 삭제한다.
   * 기준은 읽은 시각(readAt)이다 — 안 읽은 알림은 대상이 아니다.
   *
   * @returns 삭제한 알림 수
   */
  async archiveStale(now: Date = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - NOTIFICATION_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const result = await this.notificationsRepo.delete({
      readAt: LessThan(cutoff),
    });
    const removed = result.affected ?? 0;
    this.logger.log(
      `알림 아카이브 완료 — 읽은 지 ${NOTIFICATION_RETENTION_DAYS}일 지난 ${removed}건 삭제`,
    );
    return removed;
  }
}
