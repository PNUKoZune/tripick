/// <reference types="jest" />

import {
  isChainBranchOutlet,
  isRetailBranchOutlet,
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

/**
 * 표본은 전부 실측 카탈로그(KTO 쇼핑 818행)에서 가져왔다. 지점 판정 자체는 이제
 * `isChainBranchOutlet` 로 카탈로그 전체에 걸리고, 여기서 쇼핑(38)에만 남는 몫은 주소 층 표기다.
 */
describe('isRetailBranchOutlet', () => {
  it('체인 지점 접미로 끝나면 소매 점포다', () => {
    for (const name of [
      '다이소 부산서면점',
      '게스 롯데프리미엄아울렛 동부산점',
      '올리브영 울산삼산대로점',
      '갤러리아백화점 광교점',
      // 시장에 입점한 체인 매장도 시장 자체가 아니라 점포다.
      '다이소 부산국제시장점',
    ]) {
      expect(isRetailBranchOutlet(name, '부산광역시 중구 중구로 3')).toBe(true);
    }
  });

  it('주소에 층이 있으면 건물 입점 점포다 (좌표가 건물 좌표라 반경 검색을 먹는다)', () => {
    for (const address of [
      '대구광역시 중구 달구벌대로 2077 (계산동2가) 1층',
      '경기도 안산시 단원구 고잔1길 12 (고잔동) 본관 4층',
      '제주특별자치도 서귀포시 안덕면 신화역사로304번길 38 B1층',
      '대구광역시 중구 달구벌대로 2127 (봉산동) S타워 9,10층',
      '부산광역시 부산진구 동성로 71 (전포동) 1~3층',
    ]) {
      expect(isRetailBranchOutlet('구찌 현대백화점 더현대 대구', address)).toBe(true);
    }
  });

  it('전통시장·상점가는 남긴다 (쇼핑 버킷을 통째로 버릴 수 없는 이유)', () => {
    for (const name of [
      '경주 중앙시장',
      '강경젓갈시장',
      '광양5일장 (1, 6일)',
      '견지동 불교용품거리',
      '고창 파머스마켓',
    ]) {
      expect(isRetailBranchOutlet(name, '경상북도 경주시 금성로 295')).toBe(false);
    }
  });

  it('단일 어절로 점으로 끝나는 보통명사는 지점이 아니다', () => {
    expect(isRetailBranchOutlet('음식점', '부산광역시 중구 중구로 3')).toBe(false);
  });
});

/**
 * 프랜차이즈 지점이 정답 랜드마크를 밀어내던 회귀를 막는다.
 * 부산 해변 케이스 상위 3위가 전부 스타벅스 지점이었고 정답 '다대포해수욕장' 은 그 아래였다.
 */
describe('isChainBranchOutlet', () => {
  it('브랜드 + 지점명 모양은 지점이다', () => {
    for (const name of [
      '스타벅스 다대포해수욕장점',
      '스타벅스 부산송정비치점',
      '스타벅스 동부산DT점',
      '교리김밥 황성직영점',
      '투썸플레이스 강화전등사점',
      '봉명동내커피 전주송천점',
      // 지점 번호도 지점이다.
      '카페온정 1호점',
      // 체인 실내 놀이시설도 같은 모양으로 attraction 에 들어와 있었다(실측 139행).
      '더클라임 클라이밍 마곡점',
      '볼베어파크 부천점',
    ]) {
      expect(isChainBranchOutlet(name)).toBe(true);
    }
  });

  it('마지막 어절이 본점 하나뿐이면 지점이 아니라 대표점이다', () => {
    // 이 모양 426행 중 브랜드만 있는 행이 따로 있는 건 29행뿐 — 함께 지우면 397곳이 사라진다.
    for (const name of ['성심당 본점', '실비생선구이 본점', '풍성제과 본점', '동양백반 경주황리단길 본점']) {
      expect(isChainBranchOutlet(name)).toBe(false);
    }
    // 지역명이 붙은 형태는 대표점 면제가 아니다.
    expect(isChainBranchOutlet('가마솥밥상 철산본점')).toBe(true);
    expect(isChainBranchOutlet('교리김밥 경주본점')).toBe(true);
  });

  it('마지막 어절이 업종 보통명사면 지점이 아니다 (단독 가게)', () => {
    for (const name of [
      '하얀집 낙지전문점',
      '동궁 반점',
      '3.3 국밥전문점',
      '고씨네 생선구이 전문점',
      '참살이 오리전문점',
    ]) {
      expect(isChainBranchOutlet(name)).toBe(false);
    }
  });

  it('업종어가 지점명 안에 우연히 들어간 것은 면제하지 않는다', () => {
    // '테크노점' 은 '노점' 으로 끝나 부분일치 면제에 걸렸다 — 마지막 어절의 끝만 봐야 한다.
    expect(isChainBranchOutlet('카페프리헷 대구테크노점')).toBe(true);
    // '강서점' ⊃ '서점'
    expect(isChainBranchOutlet('스타벅스 청주강서점')).toBe(true);
  });

  it('지점 접미가 없는 장소는 건드리지 않는다', () => {
    for (const name of ['다대포해수욕장', '불국사', '서면밀면', '송정3대국밥', '음식점']) {
      expect(isChainBranchOutlet(name)).toBe(false);
    }
  });
});
