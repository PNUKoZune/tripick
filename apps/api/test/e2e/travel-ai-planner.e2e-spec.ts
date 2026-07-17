/// <reference types="jest" />

import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { io, type Socket } from 'socket.io-client';
import { fitsInAwakeWindow, getAwakeWindow, getKstMinutes } from '@tripick/utils';
import type {
  ItineraryItemDto,
  LoginResponseDto,
  PlannerTripDto,
  PreferenceDto,
  ReplanJobDto,
  ReplanResultDto,
  TripSummaryDto,
} from '@tripick/types';
import { AppModule } from '../../src/app.module';

describe('Travel AI planner E2E', () => {
  let app: INestApplication;
  let baseUrl: string;
  let accessToken: string;
  let createdTripId: string | undefined;

  beforeAll(async () => {
    process.env['NODE_ENV'] = 'development';
    process.env['LLM_PLANNER_ENABLED'] = process.env['LLM_PLANNER_ENABLED'] ?? 'true';
    process.env['PLACE_RETRIEVAL_AUTO_SEED'] = process.env['PLACE_RETRIEVAL_AUTO_SEED'] ?? 'true';

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );

    await app.listen(0);
    const address = app.getHttpServer().address();
    const port = typeof address === 'object' && address ? address.port : 0;
    baseUrl = `http://127.0.0.1:${port}/api/v1`;
    (global as typeof globalThis & { __TRIPICK_REALTIME_URL__?: string }).__TRIPICK_REALTIME_URL__ =
      `http://127.0.0.1:${port}/realtime`;

    const session = await post<LoginResponseDto>('/auth/demo', {
      nickname: `E2E 여행자 ${Date.now()}`,
    });
    accessToken = session.tokens.accessToken;
  }, 120000);

  afterAll(async () => {
    if (createdTripId) {
      await request(`/trips/${createdTripId}`, { method: 'DELETE' }).catch(() => undefined);
    }
    await app?.close();
  });

  it('creates a preference-based AI itinerary and pushes a real-time replan result', async () => {
    const preference = await put<PreferenceDto>('/preferences', {
      tasteTags: {
        food: ['cafe', 'korean'],
        mood: ['romantic', 'healing'],
        environment: ['beach', 'city'],
        confidence: 0.92,
      },
      profile: {
        likedThemes: ['cafe_dessert', 'local_food'],
        dislikedThemes: ['themepark'],
        wakeTime: '09:00',
        sleepTime: '22:00',
        transportModes: ['transit'],
      },
    });

    expect(preference.tasteTags.food).toContain('cafe');
    expect(preference.profile?.wakeTime).toBe('09:00');

    // 아직 오지 않은 날이라야 status 가 'upcoming' 이다. 날짜를 고정하면 그 날이 지나는
    // 순간 'done' 이 되어 테스트가 시한폭탄이 된다.
    const tripDate = isoDateFromToday(2);
    const trip = await post<TripSummaryDto>('/main-planner/trips', {
      title: `PDF E2E 부산 여행 ${Date.now()}`,
      destination: '부산',
      startDate: tripDate,
      startTime: '09:00',
      endDate: tripDate,
      endTime: '21:00',
      members: [],
      notes: '바다, 카페, 무리하지 않는 동선 위주',
    });
    createdTripId = trip.id;

    expect(trip.status).toBe('upcoming');
    expect(trip.itemCount).toBeGreaterThanOrEqual(3);

    const planner = await get<PlannerTripDto>(`/main-planner/trips/${trip.id}`);
    expect(planner.meta.tasteTags.food).toContain('cafe');
    expect(planner.items.length).toBeGreaterThanOrEqual(3);
    expect(planner.mapMarkers.length).toBe(planner.items.length);

    const itinerary = await get<ItineraryItemDto[]>(`/trips/${trip.id}/itinerary`);
    expect(itinerary.length).toBe(planner.items.length);
    // memo 는 사용자 메모 공간이라 생성 단계의 AI 추론(취향·confidence·CRAG 근거)을
    // 담지 않는다(186e5df). 생성이 여기에 쓰기 시작하면 사용자 메모를 덮어쓴다.
    expect(itinerary.every((item) => !item.memo)).toBe(true);
    expect(itinerary.every((item) => isWithinKstBounds(item.scheduledAt, item.durationMin, '09:00', '22:00'))).toBe(true);

    const socket = await connectSocket(accessToken, trip.id);
    const pushed = waitForReplan(socket);

    const job = await post<ReplanJobDto>('/alternative/waiting', {
      tripId: trip.id,
      trigger: 'waiting',
      waitingMinutes: 35,
      currentLocation: itinerary[0]?.coordinates,
    });

    expect(job.status).toBe('pending');
    expect(job.trigger).toBe('waiting');

    const result = await pushed;
    socket.close();

    expect(result.status).toBe('completed');
    expect(result.tripId).toBe(trip.id);
    expect(result.updatedItems?.length).toBeGreaterThanOrEqual(3);
    // 재계획 반영 여부는 항목 이름으로 본다. 재계획 사유도 memo 에 쓰지 않는다 —
    // 쓰면 사용자가 직접 남긴 메모를 덮어쓴다.
    expect(result.updatedItems?.some((item) => item.name.includes('waiting 대응'))).toBe(true);
    expect(result.updatedItems?.every((item) => !item.memo)).toBe(true);

    const replanned = await get<ItineraryItemDto[]>(`/trips/${trip.id}/itinerary`);
    expect(replanned.some((item) => item.name.includes('waiting 대응'))).toBe(true);
    expect(replanned.every((item) => isWithinKstBounds(item.scheduledAt, item.durationMin, '09:00', '22:00'))).toBe(true);
  }, 120000);

  async function get<T>(path: string): Promise<T> {
    return request<T>(path, { method: 'GET' });
  }

  async function post<T>(path: string, body: unknown): Promise<T> {
    return request<T>(path, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  async function put<T>(path: string, body: unknown): Promise<T> {
    return request<T>(path, {
      method: 'PUT',
      body: JSON.stringify(body),
    });
  }

  async function request<T>(path: string, init: RequestInit): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set('Content-Type', 'application/json');
    if (accessToken) {
      headers.set('Authorization', `Bearer ${accessToken}`);
    }

    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers,
    });

    if (!response.ok) {
      throw new Error(`${init.method ?? 'GET'} ${path} failed: ${response.status} ${await response.text()}`);
    }

    if (response.status === 204) {
      return undefined as T;
    }
    return response.json() as Promise<T>;
  }
});

function connectSocket(token: string, tripId: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    let connected = false;
    let joinSent = false;
    const socket = io(globalBaseRealtimeUrl(), {
      auth: { token },
      reconnection: false,
      timeout: 10000,
    });

    const timer = setTimeout(() => {
      socket.close();
      reject(new Error(`socket join timed out (connected=${connected}, joinSent=${joinSent})`));
    }, 15000);

    socket.on('connect', () => {
      connected = true;
      setTimeout(() => {
        joinSent = true;
        socket.emit('join-trip', { tripId }, (ack: { event?: string; tripId?: string }) => {
          clearTimeout(timer);
          if (ack?.event === 'joined' && ack.tripId === tripId) {
            resolve(socket);
            return;
          }
          socket.close();
          reject(new Error(`socket join failed: ${JSON.stringify(ack)}`));
        });
      }, 100);
    });

    socket.on('connect_error', (error) => {
      clearTimeout(timer);
      socket.close();
      reject(error);
    });

    socket.on('disconnect', (reason) => {
      if (reason === 'io client disconnect') return;
      clearTimeout(timer);
      reject(new Error(`socket disconnected before join: ${reason}`));
    });
  });
}

function waitForReplan(socket: Socket): Promise<ReplanResultDto> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('replan_result timed out'));
    }, 60000);

    socket.on('replan_result', (result: ReplanResultDto) => {
      clearTimeout(timer);
      resolve(result);
    });
  });
}

/**
 * 서버 로컬 날짜 기준 오늘 + offsetDays 일 ("YYYY-MM-DD").
 * main-planner 의 summaryStatus 가 로컬 날짜로 여행 상태를 정하므로 같은 기준을 쓴다.
 */
function isoDateFromToday(offsetDays: number): string {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function isWithinKstBounds(iso: string, durationMin: number, wakeTime: string, sleepTime: string): boolean {
  // 판정은 프로덕션과 같은 정본을 쓴다 — 여기서 따로 계산하면 자정을 넘는 구간에서 어긋난다.
  return fitsInAwakeWindow(getKstMinutes(new Date(iso)), durationMin, getAwakeWindow(wakeTime, sleepTime));
}

function globalBaseRealtimeUrl(): string {
  const address = (global as typeof globalThis & { __TRIPICK_REALTIME_URL__?: string }).__TRIPICK_REALTIME_URL__;
  if (!address) {
    throw new Error('realtime URL not initialized');
  }
  return address;
}
