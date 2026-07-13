/// <reference types="jest" />

import { NotificationService } from '../../src/notification/notification.service';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import type { PushNotificationDto } from '@tripick/types';

jest.mock('firebase-admin/app', () => ({
  cert: jest.fn(() => ({})),
  getApp: jest.fn(),
  getApps: jest.fn(() => []),
  initializeApp: jest.fn(() => ({ name: 'tripick' })),
}));
jest.mock('firebase-admin/messaging', () => ({ getMessaging: jest.fn() }));

const mockedGetApps = getApps as jest.Mock;
const mockedInitApp = initializeApp as jest.Mock;
const mockedGetMessaging = getMessaging as jest.Mock;

function config(overrides: Record<string, string> = {}) {
  return {
    get: <T>(key: string, def?: T) => (key in overrides ? (overrides[key] as unknown as T) : def),
  } as any;
}

const FIREBASE_ENV = {
  FIREBASE_PROJECT_ID: 'proj',
  FIREBASE_CLIENT_EMAIL: 'svc@proj.iam',
  FIREBASE_PRIVATE_KEY: '-----BEGIN-----\\nkey\\n-----END-----',
};

const push: PushNotificationDto = {
  userId: 'u1',
  title: '재계획 완료',
  body: '일정이 바뀌었어요',
  type: 'replan_ready',
};

describe('NotificationService', () => {
  const send = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetApps.mockReturnValue([]);
    mockedGetMessaging.mockReturnValue({ send });
  });

  it('skips initialization when firebase env is incomplete', () => {
    const svc = new NotificationService(config());
    svc.onModuleInit();
    expect(mockedInitApp).not.toHaveBeenCalled();
  });

  it('initializes firebase-admin when env is complete', () => {
    const svc = new NotificationService(config(FIREBASE_ENV));
    svc.onModuleInit();
    expect(mockedInitApp).toHaveBeenCalledTimes(1);
  });

  it('is a no-op send when the fcm token is missing', async () => {
    const svc = new NotificationService(config(FIREBASE_ENV));
    svc.onModuleInit();
    await svc.send(push, null);
    expect(send).not.toHaveBeenCalled();
  });

  it('is a no-op send when firebase was never initialized', async () => {
    const svc = new NotificationService(config()); // env 없음 → app undefined
    svc.onModuleInit();
    await svc.send(push, 'token-abc');
    expect(send).not.toHaveBeenCalled();
  });

  it('sends a message with notification + data payload when configured', async () => {
    send.mockResolvedValue('msg-id');
    const svc = new NotificationService(config(FIREBASE_ENV));
    svc.onModuleInit();

    await svc.send({ ...push, data: { tripId: 't1' } }, 'token-abc');

    expect(send).toHaveBeenCalledTimes(1);
    const arg = send.mock.calls[0][0];
    expect(arg.token).toBe('token-abc');
    expect(arg.notification).toEqual({ title: push.title, body: push.body });
    expect(arg.data).toEqual({ type: 'replan_ready', tripId: 't1' });
  });

  it('swallows expired/unregistered token errors without throwing', async () => {
    send.mockRejectedValue({ code: 'messaging/registration-token-not-registered' });
    const svc = new NotificationService(config(FIREBASE_ENV));
    svc.onModuleInit();

    await expect(svc.send(push, 'stale-token')).resolves.toBeUndefined();
  });

  it('swallows generic send failures without throwing', async () => {
    send.mockRejectedValue(new Error('network'));
    const svc = new NotificationService(config(FIREBASE_ENV));
    svc.onModuleInit();

    await expect(svc.send(push, 'token-abc')).resolves.toBeUndefined();
  });
});
