import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type App, cert, getApp, getApps, initializeApp } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import type { PushNotificationDto } from '@tripick/types';

/**
 * Firebase FCM 푸시 알림 서비스.
 * env 미설정 / 토큰 없음 / 토큰 만료 시 모두 조용히 no-op 또는 단일 케이스 처리 — 호출자는 await 만 하면 됨.
 */
@Injectable()
export class NotificationService implements OnModuleInit {
  private readonly logger = new Logger(NotificationService.name);
  private app?: App;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    const projectId = this.config.get<string>('FIREBASE_PROJECT_ID');
    const clientEmail = this.config.get<string>('FIREBASE_CLIENT_EMAIL');
    const rawPrivateKey = this.config.get<string>('FIREBASE_PRIVATE_KEY');

    if (!projectId || !clientEmail || !rawPrivateKey) {
      this.logger.warn(
        'Firebase env not fully configured — push notifications will be skipped (project=' +
          (projectId ? 'set' : 'missing') +
          ', clientEmail=' +
          (clientEmail ? 'set' : 'missing') +
          ', privateKey=' +
          (rawPrivateKey ? 'set' : 'missing') +
          ')',
      );
      return;
    }

    const privateKey = rawPrivateKey.replace(/\\n/g, '\n');
    try {
      this.app = getApps().length
        ? getApp()
        : initializeApp({
            credential: cert({ projectId, clientEmail, privateKey }),
          });
      this.logger.log(`Firebase admin initialized (project=${projectId})`);
    } catch (err) {
      this.logger.error('Failed to initialize firebase-admin', err as Error);
    }
  }

  /** 단일 디바이스로 푸시. fcmToken 비어있거나 firebase 미초기화면 no-op. */
  async send(dto: PushNotificationDto, fcmToken?: string | null): Promise<void> {
    if (!fcmToken) return;
    if (!this.app) {
      this.logger.debug(`[PUSH skipped] firebase not initialized — title="${dto.title}"`);
      return;
    }

    try {
      await getMessaging(this.app).send({
        token: fcmToken,
        notification: { title: dto.title, body: dto.body },
        data: { type: dto.type, ...(dto.data ?? {}) },
        android: {
          priority: 'high',
          notification: { channelId: 'tripick-default', sound: 'default' },
        },
        apns: {
          payload: { aps: { sound: 'default' } },
        },
      });
    } catch (err) {
      const code = (err as { code?: string }).code;
      // 만료/미등록 토큰 — 호출자에게 의미 있는 신호로 throw 하지 않고 로그만 남김.
      // 추후 FcmToken 테이블 분리되면 이 시점에 토큰 제거 로직 추가.
      if (
        code === 'messaging/registration-token-not-registered' ||
        code === 'messaging/invalid-registration-token'
      ) {
        this.logger.warn(`FCM token invalid/expired — token=${fcmToken.slice(0, 12)}…`);
        return;
      }
      this.logger.error(`FCM send failed: ${(err as Error).message}`, err as Error);
    }
  }
}
