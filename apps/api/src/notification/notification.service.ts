import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { PushNotificationDto } from '@tripick/types';

/**
 * Firebase FCM 푸시 알림 서비스
 *
 * firebase-admin 초기화 후 sendEachForMulticast 사용.
 * MVP 단계에서는 직접 HTTP v1 API 호출.
 */
@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(private readonly config: ConfigService) {}

  async send(dto: PushNotificationDto, fcmToken: string): Promise<void> {
    const projectId = this.config.get<string>('FIREBASE_PROJECT_ID');
    if (!projectId) {
      this.logger.warn('FIREBASE_PROJECT_ID not configured, skipping push');
      return;
    }

    // TODO: firebase-admin SDK 초기화 후 실제 구현
    this.logger.log(
      `[PUSH] to=${fcmToken?.slice(0, 12)}… title="${dto.title}" type=${dto.type}`,
    );
  }
}
