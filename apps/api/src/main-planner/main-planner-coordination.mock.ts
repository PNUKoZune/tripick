import type { PlannerCoordinationDto } from '@tripick/types';

import { PLANNER_TRIP_MOCK } from './main-planner.mock';

/**
 * Trip 별 취향 조율 v1 mock.
 * 실제 데이터는 PreferenceModule + RAG 가 생성하지만, planner 탭 검수는 이 fixture 로 진행한다.
 *
 * NOTE: 기본 3명(태/박/홍) + 시트에서 추가된 친구의 이니셜은 voters 에 자동 합류시키지 않는다.
 * 동적 멤버 변경은 별도 mock 일관성 관리 비용이 커 backlog 로 미룬다.
 */
export const PLANNER_COORDINATION_MOCK: PlannerCoordinationDto = {
  tripId: PLANNER_TRIP_MOCK.id,
  members: [
    { id: 'm1', initial: '태', color: '#3182F6', tasteLabels: ['한식·전통', '카페'] },
    { id: 'm2', initial: '박', color: '#6B7684', tasteLabels: ['양식', '문화·역사'] },
    { id: 'm3', initial: '홍', color: '#191F28', tasteLabels: ['감성 코스', '도시'] },
  ],
  consensus: {
    food: [
      { key: 'cafe', label: '카페·디저트', count: 2, voters: ['태', '홍'] },
      { key: 'korean', label: '한식·전통', count: 2, voters: ['태', '박'] },
      { key: 'western', label: '양식', count: 1, voters: ['박'] },
    ],
    mood: [
      { key: 'cultural', label: '문화·역사', count: 2, voters: ['박', '태'] },
      { key: 'romantic', label: '감성 코스', count: 2, voters: ['홍', '태'] },
      { key: 'adventure', label: '액티비티', count: 0, voters: [] },
    ],
    environment: [
      { key: 'city', label: '도시·골목', count: 3, voters: ['태', '박', '홍'] },
      { key: 'nature', label: '자연·산', count: 1, voters: ['박'] },
      { key: 'village', label: '로컬 동네', count: 1, voters: ['홍'] },
    ],
  },
  recommendation: {
    title: '낮엔 유적, 저녁엔 감성 카페 코스',
    summary:
      '문화·역사 취향(2표)와 감성 코스(2표)가 균형을 이루고, 식사는 카페·한식이 동률입니다. 도시 중심 동선이 합의됐어요.',
    reasons: [
      '· 1일차 첨성대·황리단길은 문화·감성 모두 만족',
      '· 교리김밥으로 한식 표를 살리고, 황리단길 카페로 디저트 일정 보강',
      '· 모든 동선이 시내 반경 5km 안 → 이동 부담 최소',
    ],
    scheduleHint: '오전: 유적지 / 오후: 카페 거리 / 저녁: 한식 한 끼 패턴을 일정에 적용했어요.',
  },
};
