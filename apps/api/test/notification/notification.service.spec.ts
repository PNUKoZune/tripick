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

function tokenService(tokens: string[] = []) {
  return {
    listTokens: jest.fn(async () => tokens),
    remove: jest.fn(async () => undefined),
    register: jest.fn(async () => undefined),
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
    const svc = new NotificationService(config(), tokenService());
    svc.onModuleInit();
    expect(mockedInitApp).not.toHaveBeenCalled();
  });

  it('initializes firebase-admin when env is complete', () => {
    const svc = new NotificationService(config(FIREBASE_ENV), tokenService());
    svc.onModuleInit();
    expect(mockedInitApp).toHaveBeenCalledTimes(1);
  });

  it('is a no-op send when the fcm token is missing', async () => {
    const svc = new NotificationService(config(FIREBASE_ENV), tokenService());
    svc.onModuleInit();
    expect(await svc.send(push, null)).toBe('skipped');
    expect(send).not.toHaveBeenCalled();
  });

  it('is a no-op send when firebase was never initialized', async () => {
    const svc = new NotificationService(config(), tokenService()); // env 없음 → app undefined
    svc.onModuleInit();
    expect(await svc.send(push, 'token-abc')).toBe('skipped');
    expect(send).not.toHaveBeenCalled();
  });

  it('sends a message with notification + data payload when configured', async () => {
    send.mockResolvedValue('msg-id');
    const svc = new NotificationService(config(FIREBASE_ENV), tokenService());
    svc.onModuleInit();

    expect(await svc.send({ ...push, data: { tripId: 't1' } }, 'token-abc')).toBe('ok');

    expect(send).toHaveBeenCalledTimes(1);
    const arg = send.mock.calls[0][0];
    expect(arg.token).toBe('token-abc');
    expect(arg.notification).toEqual({ title: push.title, body: push.body });
    expect(arg.data).toEqual({ type: 'replan_ready', tripId: 't1' });
  });

  it('reports expired/unregistered token as invalid without throwing', async () => {
    send.mockRejectedValue({ code: 'messaging/registration-token-not-registered' });
    const svc = new NotificationService(config(FIREBASE_ENV), tokenService());
    svc.onModuleInit();

    await expect(svc.send(push, 'stale-token')).resolves.toBe('invalid');
  });

  it('swallows generic send failures without throwing', async () => {
    send.mockRejectedValue(new Error('network'));
    const svc = new NotificationService(config(FIREBASE_ENV), tokenService());
    svc.onModuleInit();

    await expect(svc.send(push, 'token-abc')).resolves.toBe('skipped');
  });

  it('sendToUser fans out to every device token', async () => {
    send.mockResolvedValue('msg-id');
    const tokens = tokenService(['tok-a', 'tok-b']);
    const svc = new NotificationService(config(FIREBASE_ENV), tokens);
    svc.onModuleInit();

    await svc.sendToUser(push);

    expect(tokens.listTokens).toHaveBeenCalledWith('u1');
    expect(send).toHaveBeenCalledTimes(2);
    expect(tokens.remove).not.toHaveBeenCalled();
  });

  it('sendToUser removes tokens rejected as invalid', async () => {
    send
      .mockRejectedValueOnce({ code: 'messaging/invalid-registration-token' })
      .mockResolvedValueOnce('msg-id');
    const tokens = tokenService(['stale', 'fresh']);
    const svc = new NotificationService(config(FIREBASE_ENV), tokens);
    svc.onModuleInit();

    await svc.sendToUser(push);

    expect(tokens.remove).toHaveBeenCalledTimes(1);
    expect(tokens.remove).toHaveBeenCalledWith('stale');
  });

  it('sendToUser never rejects even if token cleanup throws', async () => {
    send.mockRejectedValue({ code: 'messaging/invalid-registration-token' });
    const tokens = tokenService(['stale']);
    tokens.remove.mockRejectedValue(new Error('db down'));
    const svc = new NotificationService(config(FIREBASE_ENV), tokens);
    svc.onModuleInit();

    await expect(svc.sendToUser(push)).resolves.toBeUndefined();
  });

  it('sendToUser is a no-op when the user has no tokens', async () => {
    const tokens = tokenService([]);
    const svc = new NotificationService(config(FIREBASE_ENV), tokens);
    svc.onModuleInit();

    await svc.sendToUser(push);

    expect(send).not.toHaveBeenCalled();
  });
});
