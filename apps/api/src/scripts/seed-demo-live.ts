/**
 * 데모 계정에 "여행 중(Live)" 화면 테스트용 데이터를 시드한다.
 *
 * 대상 계정은 `SEED_USER_EMAIL` 로 지정한다 — 예전에는 아무나 부를 수 있는 데모 로그인이
 * kakaoId=demo-user 계정을 자동 생성해 줬지만, 그 엔드포인트(모든 방문자가 계정 하나를
 * 공유하던 구멍)를 없앴다. 이제 데모용 계정도 그냥 일반 계정으로 만들어 쓴다.
 *
 * 오늘 날짜의 당일 여행 + 시간대별 일정 6개를 생성한다.
 * 진행 상태(done/current/upcoming)는 실행 시점의 현재 시각에 따라 자동으로 나뉜다.
 *
 * 실행: cd apps/api && SEED_USER_EMAIL=demo@tripick.place pnpm seed:demo-live
 * 멱등성: 같은 제목의 기존 데모 여행을 지우고 다시 만든다.
 *
 * AppModule 전체(BullMQ/Redis/synchronize)를 띄우지 않고, 필요한 엔티티만 등록한
 * 경량 DataSource 로 동작한다.
 */
import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DataSource } from 'typeorm';

import { ItineraryItemEntity } from '../itinerary/itinerary-item.entity';
import { TripEntity } from '../trips/trip.entity';
import { UserEntity } from '../users/user.entity';
import { toKstIsoDate } from '@tripick/utils';
import type { ItineraryItemType } from '@tripick/types';

// 의존성 없이 apps/api/.env 의 값을 process.env 로 주입 (이미 설정된 값은 유지)
function loadEnv() {
  try {
    const text = readFileSync(resolve(process.cwd(), '.env'), 'utf8');
    for (const line of text.split('\n')) {
      const match = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
      if (match && match[1] && !process.env[match[1]]) {
        process.env[match[1]] = (match[2] ?? '').replace(/^["']|["']$/g, '');
      }
    }
  } catch {
    // .env 없으면 fallback URL 사용
  }
}

loadEnv();

const SEED_TITLE = '성수·한강 당일 여행 (데모)';

interface SeedPlace {
  hour: number;
  minute: number;
  type: ItineraryItemType;
  name: string;
  address: string;
  lat: number;
  lng: number;
  durationMin: number;
}

const PLACES: SeedPlace[] = [
  { hour: 9, minute: 30, type: 'attraction', name: '성수 서울숲', address: '서울 성동구 뚝섬로 273', lat: 37.5446, lng: 127.0375, durationMin: 90 },
  { hour: 11, minute: 30, type: 'cafe', name: '성수 감도 카페', address: '서울 성동구 연무장길 45', lat: 37.5441, lng: 127.0541, durationMin: 60 },
  { hour: 13, minute: 30, type: 'restaurant', name: '을지로 한식 다이닝', address: '서울 중구 수표로 48', lat: 37.5667, lng: 126.9913, durationMin: 80 },
  { hour: 15, minute: 30, type: 'attraction', name: '국립중앙박물관', address: '서울 용산구 서빙고로 137', lat: 37.523, lng: 126.9804, durationMin: 90 },
  { hour: 17, minute: 30, type: 'attraction', name: '한강 노들섬', address: '서울 용산구 양녕로 445', lat: 37.5177, lng: 126.9574, durationMin: 70 },
  { hour: 19, minute: 30, type: 'restaurant', name: '북촌 골목 한정식', address: '서울 종로구 계동길 37', lat: 37.5826, lng: 126.9831, durationMin: 80 },
];

/** 오늘(KST) 을 YYYY-MM-DD 로. 서버 TZ 와 무관하게 데모 여행이 "오늘(KST)"에 떨어지게 한다. */
function ymd(date: Date): string {
  return toKstIsoDate(date);
}

async function main() {
  const dataSource = new DataSource({
    type: 'postgres',
    url:
      process.env.DATABASE_URL ??
      'postgresql://tripick:tripick@localhost:5432/tripick',
    entities: [UserEntity, TripEntity, ItineraryItemEntity],
    synchronize: false,
  });

  await dataSource.initialize();

  try {
    const usersRepo = dataSource.getRepository(UserEntity);
    const tripsRepo = dataSource.getRepository(TripEntity);
    const itemsRepo = dataSource.getRepository(ItineraryItemEntity);

    const seedEmail = (process.env['SEED_USER_EMAIL'] ?? '').trim().toLowerCase();
    if (!seedEmail) {
      throw new Error(
        'SEED_USER_EMAIL 이 필요합니다. 데모용 계정 이메일을 지정하세요 (예: SEED_USER_EMAIL=demo@tripick.place pnpm seed:demo-live).',
      );
    }
    const demo = await usersRepo.findOneBy({ email: seedEmail });
    if (!demo) {
      throw new Error(
        `${seedEmail} 계정이 없습니다. 웹에서 이 주소로 회원가입 + 이메일 인증을 먼저 마친 뒤 다시 시도하세요.`,
      );
    }

    // 기존 시드 여행 정리 (items 는 onDelete CASCADE 로 함께 삭제)
    await tripsRepo.delete({ userId: demo.id, title: SEED_TITLE });

    const today = new Date();
    const trip = await tripsRepo.save(
      tripsRepo.create({
        userId: demo.id,
        title: SEED_TITLE,
        destination: '서울',
        startDate: ymd(today),
        endDate: ymd(today),
        status: 'in_progress',
        transportMode: 'transit',
        wakeTime: '08:00',
        sleepTime: '23:00',
        notes: 'Live 화면 테스트용 데모 데이터',
      }),
    );

    await itemsRepo.save(
      PLACES.map((place, index) =>
        itemsRepo.create({
          tripId: trip.id,
          day: 1,
          order: index + 1,
          type: place.type,
          name: place.name,
          address: place.address,
          coordinates: { lat: place.lat, lng: place.lng },
          // 오늘(KST) HH:mm 의 절대 시각. 로컬 TZ Date 생성자를 쓰면 UTC 서버에서 시각이 밀린다.
          scheduledAt: new Date(
            `${ymd(today)}T${String(place.hour).padStart(2, '0')}:${String(place.minute).padStart(2, '0')}:00+09:00`,
          ),
          durationMin: place.durationMin,
        }),
      ),
    );

    console.log(
      `✅ 데모 Live 데이터 생성 완료\n` +
        `   user: ${demo.nickname} (${demo.id})\n` +
        `   trip: ${trip.title} (${trip.id})\n` +
        `   날짜: ${ymd(today)} · 일정 ${PLACES.length}개`,
    );
  } finally {
    await dataSource.destroy();
  }
}

main().catch((err) => {
  console.error('❌ 시드 실패:', err);
  process.exit(1);
});
