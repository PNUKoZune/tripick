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
import { DEMO_PLACES, clockScheduledAt } from '../demo-console/demo-trip.fixture';
import { DEMO_TRIP_TITLE } from '../demo-console/demo-console.constants';

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
    await tripsRepo.delete({ userId: demo.id, title: DEMO_TRIP_TITLE });

    const today = new Date();
    const trip = await tripsRepo.save(
      tripsRepo.create({
        userId: demo.id,
        title: DEMO_TRIP_TITLE,
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
      DEMO_PLACES.map((place, index) =>
        itemsRepo.create({
          tripId: trip.id,
          day: 1,
          order: index + 1,
          type: place.type,
          name: place.name,
          address: place.address,
          coordinates: { lat: place.lat, lng: place.lng },
          // 기준 시각표 그대로 배치한다. 지금 기준으로 당겨 배치하는 건 시연 콘솔 쪽 시드다.
          scheduledAt: clockScheduledAt(place, ymd(today)),
          durationMin: place.durationMin,
        }),
      ),
    );

    console.log(
      `✅ 데모 Live 데이터 생성 완료\n` +
        `   user: ${demo.nickname} (${demo.id})\n` +
        `   trip: ${trip.title} (${trip.id})\n` +
        `   날짜: ${ymd(today)} · 일정 ${DEMO_PLACES.length}개`,
    );
  } finally {
    await dataSource.destroy();
  }
}

main().catch((err) => {
  console.error('❌ 시드 실패:', err);
  process.exit(1);
});
