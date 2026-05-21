import type { DestinationSuggestionDto } from '@tripick/types';

/**
 * 여행 생성 폼 자동완성용 정적 후보 목록.
 * 실제로는 카카오 로컬 API + 한국관광공사 데이터를 사용하지만, v1 mock 에선 고정 fixture 만 반환한다.
 */
export const DESTINATIONS_MOCK: DestinationSuggestionDto[] = [
  { id: 'gyeongju', name: '경주', region: '경상북도', emoji: '🏛️' },
  { id: 'busan', name: '부산', region: '부산광역시', emoji: '🌊' },
  { id: 'haeundae', name: '해운대', region: '부산광역시', emoji: '🏖️' },
  { id: 'gwangalli', name: '광안리', region: '부산광역시', emoji: '🌉' },
  { id: 'jeonpo', name: '전포 카페거리', region: '부산광역시', emoji: '☕' },
  { id: 'jeju', name: '제주', region: '제주특별자치도', emoji: '🌴' },
  { id: 'seogwipo', name: '서귀포', region: '제주특별자치도', emoji: '🌺' },
  { id: 'udo', name: '우도', region: '제주특별자치도', emoji: '🐚' },
  { id: 'gangneung', name: '강릉', region: '강원특별자치도', emoji: '☕' },
  { id: 'sokcho', name: '속초', region: '강원특별자치도', emoji: '🐟' },
  { id: 'yangyang', name: '양양', region: '강원특별자치도', emoji: '🏄' },
  { id: 'pyeongchang', name: '평창', region: '강원특별자치도', emoji: '⛰️' },
  { id: 'jeonju', name: '전주', region: '전라북도', emoji: '🥢' },
  { id: 'yeosu', name: '여수', region: '전라남도', emoji: '🌃' },
  { id: 'tongyeong', name: '통영', region: '경상남도', emoji: '⛵' },
  { id: 'damyang', name: '담양', region: '전라남도', emoji: '🎋' },
  { id: 'andong', name: '안동', region: '경상북도', emoji: '🏯' },
  { id: 'pohang', name: '포항', region: '경상북도', emoji: '🌅' },
  { id: 'chuncheon', name: '춘천', region: '강원특별자치도', emoji: '🚣' },
  { id: 'seoul', name: '서울', region: '서울특별시', emoji: '🏙️' },
  { id: 'incheon', name: '인천', region: '인천광역시', emoji: '🛫' },
  { id: 'suwon', name: '수원', region: '경기도', emoji: '🏰' },
];

export function searchDestinationsMock(query: string): DestinationSuggestionDto[] {
  const q = query.trim().toLowerCase();
  if (!q) return DESTINATIONS_MOCK.slice(0, 8);
  return DESTINATIONS_MOCK.filter(
    (d) => d.name.toLowerCase().includes(q) || d.region.toLowerCase().includes(q),
  ).slice(0, 10);
}
