/**
 * 네이버 추천 글 코퍼스에서 장소명 후보를 뽑는다 (forward extraction).
 *
 * 왜 방향을 뒤집나 — 런타임 인지도 신호(`NaverPopularityIndex`)는 "깨끗한 후보 name 이
 * 코퍼스에 몇 번 나오나"를 세는 **역방향** 매칭이라 후보를 만들어낼 수 없다. 카탈로그에 없는
 * 대표 명소는 셀 대상 자체가 없어서 블로그에 100번 나와도 검색 결과에 못 들어온다.
 * 적재 단계에선 코퍼스에서 이름을 직접 만들어내야 한다.
 *
 * 한글 NER 이 불안정하다는 사실은 그대로다. 그래서 이 모듈의 출력은 **제안**일 뿐이고,
 * 정확성은 뒤의 두 관문이 책임진다 (`PopularPlaceService`):
 *   ① 카카오 키워드 검색이 정본 이름·좌표·주소를 준다 (gazetteer 로 정규화)
 *   ② 그 정본 이름을 역방향 인덱스로 되짚어 코퍼스에 실제로 있는지 확인
 * ② 가 결정적이다 — '여행' 같은 쓰레기 후보는 카카오가 '경주여행사' 로 정규화해 주지만
 * 코퍼스에는 '경주여행' 만 있어 정본명 언급이 0 이라 탈락한다.
 *
 * 즉 이 단계의 정밀도는 **카카오 호출 수에만** 영향을 주고 적재 품질에는 영향이 없다.
 * 그래서 휴리스틱을 최소로 둔다 — 불용어 + 활용어미 컷 + 빈도순. 접미사('산'·'사'·'해수욕장')
 * 가중 같은 튜닝은 검증 수단이 없어 넣지 않았다.
 */

import { isRegionLabel } from './region-code';

/** 후보 1건. frequency 는 코퍼스 토큰 등장 횟수(변형 포함). */
export interface PlaceNameCandidate {
  name: string;
  frequency: number;
}

export interface ExtractOptions {
  /** 상위 몇 개까지 돌려줄지 */
  limit: number;
  /** 후보에서 뺄 토큰 (보통 지역명 — '경주 경주' 같은 무의미 조회 방지) */
  excludeTokens?: readonly string[];
}

/** 한글·숫자·영소문자 이외를 경계로 토큰을 자른다 (코퍼스는 이미 소문자 정규화된 상태). */
const TOKEN_BOUNDARY = /[^가-힣0-9a-z]+/;

const MIN_NAME_LENGTH = 2;
const MAX_NAME_LENGTH = 15;

/**
 * 추천 글 300여 건에서 딱 한 번 나온 이름은 '대표' 명소·맛집이 아니다.
 * 하한을 2 로 두면 카카오 조회 비용이 절반 이하로 줄고 놓치는 대표 장소는 없다.
 */
const MIN_FREQUENCY = 2;

/**
 * 끝에서 한 번만 떼는 조사. 긴 것부터 봐야 '에서'가 '서'로 먼저 잘리지 않는다.
 * 떼기 전 원형도 후보로 함께 남긴다 — '오륙도'처럼 조사와 같은 글자로 끝나는 이름이 있어
 * 한쪽만 남기면 놓친다(뗀 '오륙'도 카카오가 '오륙도'로 정규화해 주므로 둘 다 무해).
 *
 * 주격 '이'·'가' 는 일부러 뺐다 — 실측에서 '나들이'가 '나들'로 잘리고, 카카오에 실제로
 * '나들'이라는 상호가 있어 관문을 통과했다. 장소명 뒤 주격 조사는 블로그 문장에서 드물어
 * 빼도 잃는 게 없다.
 */
const TRAILING_PARTICLES = [
  '에서는', '에서', '으로는', '으로', '이랑', '까지', '부터', '에는', '이라', '라고',
  '처럼', '보다', '마다', '만큼', '한테', '에게',
  '은', '는', '을', '를', '의', '에', '도', '와', '과', '로', '랑', '만', '나',
] as const;

/**
 * 용언 활용형 어미. 블로그 코퍼스 노이즈의 대부분이 '다녀왔어요'·'좋았습니다' 류다.
 * 장소명이 이 어미로 끝나는 경우는 사실상 없어 오탈락 위험이 낮다.
 */
const INFLECTED_ENDING =
  /(습니다|니다|는데|지만|면서|어서|아서|라서|네요|어요|아요|세요|해요|이다|았|었|겠|요|다|죠|까|며|잖아)$/;

/**
 * 여행 블로그 상투어. 빈도만 보면 이것들이 최상위를 다 차지해 실제 장소명이 limit 밖으로
 * 밀린다. 관문 ②가 어차피 걸러내지만 카카오 호출을 낭비하지 않으려고 앞에서 자른다.
 * (여기 있는 단어가 실제 장소명의 일부인 건 무해하다 — '강릉커피거리'는 별개 토큰이다.)
 */
const STOPWORDS = new Set([
  // 여행 일반
  '여행', '여행지', '여행기', '관광', '관광지', '국내', '국내여행', '해외', '해외여행',
  '맛집', '카페', '추천', '코스', '명소', '핫플', '핫플레이스', '가볼만한', '볼거리', '먹거리',
  '스팟', '리스트', '모음', '베스트', '인기', '유명', '필수', '대표', '최고', '강추', '총정리',
  '놀거리',
  '나들이', '데이트', '산책', '구경', '체험', '축제', '행사', '투어', '일정', '숙소', '호텔',
  '펜션', '리조트', '게스트하우스', '렌트', '렌트카', '항공', '기차', '버스', '지하철',
  // 글쓰기 상투어
  '후기', '리뷰', '사진', '소개', '정리', '방문', '블로그', '포스팅', '안내', '문의', '이용',
  '준비', '출발', '도착', '위치', '근처', '주변', '주차', '주차장', '입장료', '가격', '예약',
  '영업', '영업시간', '시간', '하루', '이틀', '당일', '주말', '평일', '오늘', '어제', '내일',
  '요즘', '최근', '이번', '이번주', '다음', '가족', '친구', '커플', '아이', '아이들', '반려견', '혼자',
  '날씨', '기온', '풍경', '분위기', '느낌', '기분', '생각', '사람', '정도', '이상', '여기',
  '저기', '거기', '진짜', '정말', '너무', '완전', '역시', '그리고', '하지만', '지역', '전국',
  // 계절·음식 일반
  '봄', '여름', '가을', '겨울', '여름휴가', '단풍', '벚꽃', '메뉴', '음식', '식당',
  '점심', '저녁', '아침', '브런치', '디저트', '커피', '술집', '포장', '배달',
  '가성비', '저렴', '푸짐',
  // 실측 상위를 점거했던 관형형·부사형. 활용어미 정규식으로는 안 잡히는 형태만 나열한다.
  '있는', '없는', '좋은', '같은', '만한', '함께', '시원한', '아름다운', '바로', '보고',
  '정보', '자연', '힐링', '당일치기', '근처에', '이곳', '따라', '주소', '즐길', '많이',
  '많은', '있어', '가볼', '가장', '숨은', '어디', '어디가', '휴가', '국내여행지', '계곡',
  '드라이브', '액티비티', '특별한', '위치한', '추천하', '추천하는', '싶은', '푸른', '유명한',
]);

/**
 * 카카오에 실제로 등록돼 있지만 상호가 아니라 검색 노출용 문구인 이름.
 * 실측에서 '서울맛집'·'신촌맛집'(성동구·마포구 실존 음식점), '놀만한곳', '만남의장소' 가
 * 관문 ②를 통과했다 — 코퍼스에 그 문구가 그대로 있으니 언급 수가 0 이 아니다.
 * 이런 이름은 일정 카드에 올랐을 때 장소로 읽히지 않으므로 정본명 단계에서 뺀다.
 */
const GENERIC_CANONICAL_NAME = /(맛집|여행|관광|명소|핫플|추천|코스|곳|장소)$/;

/** 카카오가 준 정본명이 상호가 아니라 상투어인지. */
export function isGenericPlaceName(name: string): boolean {
  const compact = name.replace(/\s+/g, '');
  return STOPWORDS.has(compact) || GENERIC_CANONICAL_NAME.test(compact);
}

/**
 * 코퍼스에서 장소명 후보를 빈도순으로 뽑는다.
 * 순수 함수 — 외부 호출 없이 문자열만 본다(테스트 가능).
 */
export function extractPlaceNameCandidates(
  corpus: string,
  options: ExtractOptions,
): PlaceNameCandidate[] {
  const exclude = new Set(
    (options.excludeTokens ?? []).map((token) => token.trim().toLowerCase()).filter(Boolean),
  );
  const counts = new Map<string, number>();

  for (const token of corpus.split(TOKEN_BOUNDARY)) {
    for (const variant of nameVariants(token)) {
      if (!isPlausibleName(variant, exclude)) continue;
      counts.set(variant, (counts.get(variant) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .filter(([, frequency]) => frequency >= MIN_FREQUENCY)
    // 빈도 동률은 이름순으로 갈라 실행마다 결과가 흔들리지 않게 한다.
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, Math.max(0, options.limit))
    .map(([name, frequency]) => ({ name, frequency }));
}

/** 원형 + 조사 1개 떼어낸 형태. */
function nameVariants(token: string): string[] {
  const base = token.trim();
  if (!base) return [];
  const stripped = stripTrailingParticle(base);
  return stripped ? [base, stripped] : [base];
}

/** 끝 조사 1개를 뗀다. 뗀 결과가 너무 짧거나 원형과 같으면 null. */
function stripTrailingParticle(token: string): string | null {
  for (const particle of TRAILING_PARTICLES) {
    if (!token.endsWith(particle)) continue;
    const stripped = token.slice(0, -particle.length);
    return stripped.length >= MIN_NAME_LENGTH ? stripped : null;
  }
  return null;
}

/** '6월'·'2026년'·'3박4일' 처럼 숫자+단위로 끝나는 날짜·기간 표현. */
const DATE_LIKE = /^\d+[년월일주박]/;

function isPlausibleName(name: string, exclude: ReadonlySet<string>): boolean {
  if (name.length < MIN_NAME_LENGTH || name.length > MAX_NAME_LENGTH) return false;
  // 한글이 하나도 없으면(순수 숫자·영문) 장소명으로 보지 않는다. '83타워'처럼 섞인 건 통과.
  if (!/[가-힣]/.test(name)) return false;
  if (exclude.has(name) || DATE_LIKE.test(name)) return false;
  if (INFLECTED_ENDING.test(name)) return false;
  // 행정구역명은 장소가 아니다. 자기 지역('강원도')과 다른 지역('부산') 둘 다 여기서 죽는다.
  if (isRegionLabel(name)) return false;
  // 정본명에 쓰는 상투어 판정을 후보에도 적용한다 ('가볼만한곳'·'강원도여행' 류).
  if (STOPWORDS.has(name) || isGenericPlaceName(name)) return false;
  // 조사를 뗀 형태가 상투어면 붙은 형태도 상투어다 ('여행을'→'여행', '아이와'→'아이').
  const stripped = stripTrailingParticle(name);
  if (stripped && (STOPWORDS.has(stripped) || isGenericPlaceName(stripped))) return false;
  return true;
}
