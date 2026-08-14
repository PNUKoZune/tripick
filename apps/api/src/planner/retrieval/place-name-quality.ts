/**
 * 카탈로그에 **장소로 들어와선 안 되는 이름 모양**을 판별한다.
 *
 * 두 부류가 실제로 들어와 있었다 (10,608행 실측):
 *   ① SEO 상호 — '경주맛집'·'다솥맛집'·'기차여행' 처럼 검색 노출용 문구를 상호로 등록한 것.
 *      카카오에 실존 등록이라 좌표·주소가 멀쩡하고, 이름이 코퍼스 상투어와 같아 인지도 1.00 을
 *      받아 상위를 먹는다(경주 케이스 2위가 '경주맛집'이었다).
 *   ② KTO 여행코스 '글' — '가정의 달, 싱글을 위한 혼자 먹는 밥상 코스' 같은 큐레이션 기사가
 *      contentTypeId=25 로 장소처럼 내려온다. 일정 카드에 올리면 방문할 곳이 없다.
 *
 * **접미사만 보면 안 된다** — `…코스`·`…여행` 으로 끝나는 80건 중 대부분은 '해파랑길 2코스'·
 * '금정산둘레길 6코스'·'경기둘레길 가평20코스' 같은 실제 코스명이라 통째로 오탈락한다.
 * 그래서 ①은 "단일 어절 + 짧은 이름"으로 좁히고, ②는 KTO 가 준 contentTypeId=25 를 확인한
 * 뒤에만 이름 모양(주소 유무·어절 수·조사)을 본다. 두 규칙 모두 실측으로 오탈락 0 을 확인했다.
 */

/** 검색 노출용 문구에 쓰이는 접미. 그 자체로는 판정 근거가 못 된다(위 주석 참고). */
const SEO_SUFFIX = /(맛집|여행|관광|명소|핫플|추천|코스|곳|장소)$/;

/**
 * SEO 상호로 인정할 최대 길이(공백 제거). 실측 7건이 1~5자였고, 실제 코스·시설명은
 * 이보다 길거나 여러 어절이다. 상한을 올리면 '해운대맛집거리' 류 실제 지명이 위험해진다.
 */
const SEO_NAME_MAX_LENGTH = 6;

/**
 * 글 제목에만 나오는 문장부호. 상호·시설명에는 거의 쓰이지 않는다.
 * 물결(~)은 넣지 않는다 — '비학산~금병산누리길 2코스' 처럼 실제 코스명이 구간 표기로 쓴다.
 */
const SENTENCE_PUNCTUATION = /[,!?“”‘’]/;

/**
 * 글 제목의 어절 수 하한. KTO 여행코스 중 실제 코스명은 '남파랑길 25코스'·'강화 자전거
 * 관광코스' 처럼 2~3어절이고, 4어절 이상은 실측 14건 전부 기사였다.
 */
const ARTICLE_WORD_COUNT = 4;

/** 어절 끝 조사·연결어미. 장소명 어절은 이렇게 끝나지 않는다('강원도의 자연과 문학여행'). */
const PARTICLE_ENDING = /(은|는|을|를|의|에|에서|으로|와|과|까지|부터|고|며|서|한|던|인)$/;

/**
 * 검색 노출용 문구를 상호로 등록한 이름인지 (① SEO 상호).
 * 적재에서 걸러내고, 이미 들어온 행은 검색 단계에서도 후보에서 뺀다.
 */
export function isSeoBusinessName(name: string): boolean {
  const trimmed = name.trim();
  if (!trimmed || /\s/.test(trimmed)) return false;
  if (trimmed.length > SEO_NAME_MAX_LENGTH) return false;
  return SEO_SUFFIX.test(trimmed);
}

/**
 * KTO 여행코스(contentTypeId=25) 행이 장소가 아니라 **글**인지 (② 여행코스 기사).
 * 호출 측이 contentTypeId 를 먼저 확인해야 한다 — 이 이름 모양 규칙을 카탈로그 전체에
 * 적용하면 '경산 임당동과 조영동 고분군'·'강진 병영마을 옛 담장' 같은 실제 명소가 함께 죽는다.
 */
export function isTravelCourseArticle(name: string, address: string): boolean {
  const trimmed = name.trim();
  if (!trimmed) return true;
  // KTO 는 코스 기사에 대표 좌표만 주고 주소를 비운다(실측 110건 전수 기사).
  if (!address.trim()) return true;
  if (SENTENCE_PUNCTUATION.test(trimmed)) return true;

  const words = trimmed.split(/\s+/);
  if (words.length >= ARTICLE_WORD_COUNT) return true;
  return words.some((word) => PARTICLE_ENDING.test(word));
}

/**
 * 체인 지점 접미 — 'BRAND 지역점' 모양. **앞에 다른 어절이 있어야 한다.**
 * 단일 어절로 '점' 으로 끝나는 보통명사('음식점'·'분기점')를 지점으로 오인하지 않게 하려는 것인데,
 * 실측 쇼핑 588건이 전부 공백을 포함한 'BRAND 지역점' 이라 이 제약으로 잃는 건 없다.
 */
const BRANCH_SUFFIX = /\s\S*점$/;

/**
 * 주소의 층 표기. 관측된 표기를 전부 덮는다 — '2층'·'B1층'·'본관 4층'·'9,10층'·'1~3층'·'지하 1층'.
 * 숫자 없는 '지하층'도 같은 뜻이라 함께 본다.
 */
const FLOOR_IN_ADDRESS = /(\d\s*층|지하\s*층)/;

/**
 * KTO 쇼핑(contentTypeId=38) 행이 **여행지가 아니라 소매 점포**인지.
 *
 * 호출 측이 contentTypeId 를 먼저 확인해야 한다 — 이 규칙을 카탈로그 전체에 적용하면
 * 체인 카페·식당 지점('스타벅스 해운대점')이 함께 죽는데, 그건 실제로 일정에 넣는 장소다.
 * 음식점은 39, 카페는 카카오 소스라 38 로 좁히면 그 위험이 사라진다.
 *
 * 쇼핑 버킷을 통째로 버릴 수는 없다 — 서문시장·자갈치시장 같은 **전통시장이 여기 들어 있고**,
 * 그건 취향 기반 추천의 정당한 후보다. 실측(카탈로그 내 쇼핑 818행)에서 두 신호가 그 둘을 갈랐다:
 *
 *   ① 이름이 체인 지점 접미로 끝남 — '다이소 부산서면점'·'게스 롯데프리미엄아울렛 동부산점' (588건)
 *   ② 주소에 층 표기가 있음 — 건물 안 입점 매장이라 그 좌표는 건물의 좌표다 (382건)
 *
 * 둘 중 하나라도 걸리는 635건을 빼고 남는 183건은 대부분 시장·오일장·상점가였다
 * ('경주 중앙시장'·'강경젓갈시장'·'광양5일장 (1, 6일)'·'견지동 불교용품거리').
 *
 * 왜 지워야 하나 — 반경 검색이 붙으면서 이게 실제로 결과를 먹었다. 서면역 2km 후보 33건 중
 * **9건이 롯데백화점 입점 브랜드 매장**이었다(구찌·다미아니·금강제화…). 시도 전역 검색일 때는
 * 643건 중 23건이라 묻혀 있던 비율이, 풀이 작아지자 27% 로 드러난 것이다.
 */
export function isRetailBranchOutlet(name: string, address: string): boolean {
  const trimmed = name.trim();
  if (!trimmed) return true;
  if (BRANCH_SUFFIX.test(trimmed)) return true;
  return FLOOR_IN_ADDRESS.test(address);
}
