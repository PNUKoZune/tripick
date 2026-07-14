import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type App, cert, getApp, getApps, initializeApp } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import type { PushNotificationDto } from '@tripick/types';
import { FcmTokenService } from './fcm-token.service';

/** 단일 토큰 발송 결과 — sendToUser 가 만료 토큰 정리 여부를 판단하는 데 사용. */
type SendResult = 'ok' | 'invalid' | 'skipped';

/**
 * Firebase FCM 푸시 알림 서비스.
 * env 미설정 / 토큰 없음 / 토큰 만료 시 모두 조용히 no-op 또는 단일 케이스 처리 — 호출자는 await 만 하면 됨.
 */
@Injectable()
export class NotificationService implements OnModuleInit {
  private readonly logger = new Logger(NotificationService.name);
  private app?: App;

  constructor(
    private readonly config: ConfigService,
    private readonly fcmTokens: FcmTokenService,
  ) {}

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

  /**
   * 사용자의 모든 등록 디바이스로 푸시. 토큰 없거나 firebase 미초기화면 no-op.
   * 발송 중 만료/무효 토큰이 발견되면 해당 토큰을 저장소에서 제거한다.
   */
  async sendToUser(dto: PushNotificationDto): Promise<void> {
    if (!this.app) {
      this.logger.debug(`[PUSH skipped] firebase not initialized — title="${dto.title}"`);
      return;
    }
    // 푸시는 부수효과 — 토큰 조회/정리(DB) 실패가 호출자(주로 fire-and-forget)로 전파되지
    // 않도록 여기서 삼킨다. 개별 발송 실패는 이미 send() 내부에서 처리된다.
    try {
      const tokens = await this.fcmTokens.listTokens(dto.userId);
      if (tokens.length === 0) return;

      await Promise.all(
        tokens.map(async (token) => {
          const result = await this.send(dto, token);
          if (result === 'invalid') {
            await this.fcmTokens.remove(token);
          }
        }),
      );
    } catch (err) {
      this.logger.error(`sendToUser failed (user=${dto.userId}): ${(err as Error).message}`);
    }
  }

  /** 단일 디바이스로 푸시. 반환값으로 만료 토큰 여부를 알린다(정리는 호출자 책임). */
  async send(dto: PushNotificationDto, fcmToken?: string | null): Promise<SendResult> {
    if (!fcmToken) return 'skipped';
    if (!this.app) {
      this.logger.debug(`[PUSH skipped] firebase not initialized — title="${dto.title}"`);
      return 'skipped';
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
      return 'ok';
    } catch (err) {
      const code = (err as { code?: string }).code;
      // 만료/미등록 토큰 — throw 하지 않고 'invalid' 로 알려 호출자가 저장소에서 제거하게 한다.
      if (
        code === 'messaging/registration-token-not-registered' ||
        code === 'messaging/invalid-registration-token'
      ) {
        this.logger.warn(`FCM token invalid/expired — token=${fcmToken.slice(0, 12)}…`);
        return 'invalid';
      }
      this.logger.error(`FCM send failed: ${(err as Error).message}`, err as Error);
      return 'skipped';
    }
  }
}
