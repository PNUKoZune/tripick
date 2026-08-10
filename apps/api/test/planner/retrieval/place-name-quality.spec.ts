/// <reference types="jest" />

import {
  isSeoBusinessName,
  isTravelCourseArticle,
} from '../../../src/planner/retrieval/place-name-quality';

describe('isSeoBusinessName', () => {
  it('검색 노출용 문구를 상호로 등록한 행을 잡는다', () => {
    // 카탈로그 10,608행 실측에서 걸린 7건이 전부 이 모양이었다.
    for (const name of ['경주맛집', '다솥맛집', '감내맛집', '갯마을맛집', '벽계수맛집', '기차여행', '곳']) {
      expect(isSeoBusinessName(name)).toBe(true);
    }
  });

  it('여러 어절이면 잡지 않는다 (실제 코스·시설명 보호)', () => {
    // 접미사만 보면 이 이름들이 함께 죽는다 — 실측 80건 중 대부분이 실제 코스명이었다.
    for (const name of [
      '해파랑길 2코스',
      '금정산둘레길 6코스',
      '경기둘레길 가평20코스',
      '강화 자전거 관광코스',
      '올레길 공항코스',
      '군산의 명물 먹거리 여행',
    ]) {
      expect(isSeoBusinessName(name)).toBe(false);
    }
  });

  it('단일 어절이라도 길면 잡지 않는다', () => {
    // '비슬산 드라이브코스' 류를 붙여 쓴 등록명까지 지우면 실제 장소를 잃는다.
    expect(isSeoBusinessName('비슬산드라이브코스')).toBe(false);
  });

  it('SEO 접미가 없는 짧은 이름은 그대로 둔다', () => {
    for (const name of ['우도', '오동도', '무등산', '죽녹원', '서문시장']) {
      expect(isSeoBusinessName(name)).toBe(false);
    }
  });
});

/**
 * 이 규칙은 KTO contentTypeId=25(여행코스)를 확인한 뒤에만 쓴다 — 카탈로그 전체에 적용하면
 * '경산 임당동과 조영동 고분군' 같은 실제 명소가 함께 죽는다(실측 38건 중 절반이 실제 장소).
 */
describe('isTravelCourseArticle', () => {
  it('주소 없는 행은 기사다 (KTO 는 코스 기사에 주소를 주지 않는다)', () => {
    expect(isTravelCourseArticle('고풍스러움이 흐르는 북촌', '')).toBe(true);
    expect(isTravelCourseArticle('대전의 시민 문화를 찾아 떠나는 여행', '   ')).toBe(true);
  });

  it('주소가 있어도 문장 모양이면 기사다', () => {
    for (const name of [
      '가슴 탁 트이는 속초여행',
      '너무 아름다운 뷰! 뷰! 뷰! 멋진 전망만 쏙 골라 놓은 코스',
      '가족, 연인이 함께 즐길 수 있는 문화 체험 여행 코스',
      '강원 북부 최고의 드라이브 코스로만 짜여진 아름다운 로드트립 코스',
    ]) {
      expect(isTravelCourseArticle(name, '강원특별자치도 속초시 중앙로147번길 12')).toBe(true);
    }
  });

  it('실제 코스명은 남긴다', () => {
    for (const name of [
      '남파랑길 25코스',
      '해파랑길 2코스',
      '강화 자전거 관광코스',
      '서천생태원길 배롱나무코스',
      '비학산~금병산누리길 2코스',
    ]) {
      expect(isTravelCourseArticle(name, '경남 거제시 동부면 부춘리 산 43-3')).toBe(false);
    }
  });
});
