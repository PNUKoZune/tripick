/**
 * 지역 라벨(시도·시군구)을 인덱스 가능한 정본 코드로 정규화한다.
 *
 * 왜 필요한가 — place_embeddings 의 지역 필터가 `destination_region ILIKE '경상북%'` 형태였다.
 * ILIKE 는 인덱스를 못 타서 후보가 늘면 (a) 전체 스캔이거나 (b) HNSW 가 뽑은 근사 이웃을
 * 나중에 걸러내는 post-filter 가 된다. (b) 는 지역이 선택적일수록 후보가 통째로 탈락해
 * 결과가 비는 방향으로 조용히 망가진다. 등가 비교(`region_code = $1`)로 바꾸면
 * 플래너가 btree 로 먼저 좁힌 뒤 정확 KNN 을 돌릴 수 있다.
 *
 * 코드 체계는 KTO areaCode 같은 숫자가 아니라 **한글 축약 라벨**이다. 질의 쪽은
 * 사용자가 입력한 자유 문자열('경주', '부산 해운대구')밖에 없어서, 외부 조회 없이
 * 양쪽이 같은 값을 계산할 수 있어야 한다.
 */

/** 시도 정본 코드 17개. place_embeddings.region_code 에 저장되는 값의 전체 집합. */
export const SIDO_CODES = [
  '서울', '부산', '대구', '인천', '광주', '대전', '울산', '세종',
  '경기', '강원', '충북', '충남', '전북', '전남', '경북', '경남', '제주',
] as const;

export type SidoCode = (typeof SIDO_CODES)[number];

/**
 * 시도 라벨 → 코드. 앞에서부터 매칭하므로 긴 별칭을 먼저 둔다
 * ('충청북'이 '충청남'보다 앞이어야 하는 식의 접두 충돌은 없지만, 어간이 짧은 항목은 뒤로).
 * 라벨 표기가 소스마다 섞여 있어(법정동 풀네임 '경상북도' / 옛 단축 '경북' / seed 슬러그 'gyeongbuk')
 * 셋 다 같은 코드로 떨어지게 별칭을 나열한다.
 */
const SIDO_ALIASES: ReadonlyArray<readonly [SidoCode, readonly string[]]> = [
  ['서울', ['서울', 'seoul']],
  ['부산', ['부산', 'busan']],
  ['대구', ['대구', 'daegu']],
  ['인천', ['인천', 'incheon']],
  ['광주', ['광주광역', 'gwangju']], // '광주'(경기 광주시)와 구분 위해 광역 표기만. 아래 SIDO_ONLY 참고
  ['대전', ['대전', 'daejeon']],
  ['울산', ['울산', 'ulsan']],
  ['세종', ['세종', 'sejong']],
  ['경기', ['경기', 'gyeonggi']],
  ['강원', ['강원', 'gangwon']],
  ['충북', ['충청북', '충북', 'chungbuk']],
  ['충남', ['충청남', '충남', 'chungnam']],
  ['전북', ['전라북', '전북', 'jeonbuk']],
  ['전남', ['전라남', '전남', 'jeonnam']],
  ['경북', ['경상북', '경북', 'gyeongbuk']],
  ['경남', ['경상남', '경남', 'gyeongnam']],
  ['제주', ['제주', 'jeju']],
];

/**
 * 시군구와 이름이 겹쳐 별칭 표에서 뺀 시도. 별칭이 다 빗나간 뒤에만 본다.
 * '광주' 는 광주광역시이자 경기도 광주시라 질의만으로는 못 가른다 — 광역시로 해석한다
 * (여행 목적지로서의 통상 의미). 경기 광주시를 노린 질의는 '경기 광주'로 시도를 붙여야 한다.
 */
const SIDO_ONLY: ReadonlyArray<readonly [SidoCode, string]> = [['광주', '광주']];

/**
 * 시군구 별칭. seed 카탈로그가 쓰는 로마자 슬러그를 한글 정본 코드로 맞춘다
 * (시도 로마자는 SIDO_ALIASES 가 이미 처리하므로 시군구 단위인 것만).
 */
const SIGUNGU_ALIASES: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['경주', ['gyeongju']],
];

/**
 * 행정구역 라벨 전체 집합 (정확 일치용). 별칭 어간에 접미사를 붙여 만든다.
 * 접미사를 뗀 형태('강원특별자치')도 넣는다 — 조사 '도'를 떼면 그 형태가 나온다.
 */
const REGION_LABELS: ReadonlySet<string> = (() => {
  const labels = new Set<string>();
  const suffixes = ['', '도', '시', '특별시', '광역시', '특별자치도', '특별자치시'];
  for (const [code, aliases] of [...SIDO_ALIASES, ...SIDO_ONLY.map(([c, a]) => [c, [a]] as const)]) {
    for (const stem of [code, ...aliases]) {
      if (!/[가-힣]/.test(stem)) continue;
      for (const suffix of suffixes) {
        const label = `${stem}${suffix}`;
        labels.add(label);
        // 끝 '도'·'시' 를 조사로 떼어낸 형태까지 라벨로 인정한다.
        labels.add(label.replace(/(도|시)$/, ''));
      }
    }
  }
  labels.delete('');
  return labels;
})();

/**
 * 토큰이 행정구역 라벨 그 자체인지 (장소명이 아님). 적재 후보에서 '강원도'·'제주특별자치도'·
 * '부산' 같은 지역명을 빼는 데 쓴다.
 *
 * **접두 매칭이 아니라 정확 일치**여야 한다 — `toSidoCode` 는 '강원도립화목원'도 '강원'으로
 * 잡아 주는데(접두 매칭), 그건 춘천의 실제 관광지다.
 */
export function isRegionLabel(token: string): boolean {
  return REGION_LABELS.has(token.trim().replace(/\s+/g, ''));
}

/**
 * 시도 라벨을 코드로 정규화한다. 매칭 안 되면 null.
 * 예: '경상북도'→'경북', '경북'→'경북', '서울특별시'→'서울', 'jeju'→'제주'.
 */
export function toSidoCode(label: string | null | undefined): SidoCode | null {
  if (!label) return null;
  const normalized = label.trim().toLowerCase().replace(/\s+/g, '');
  if (!normalized) return null;
  for (const [code, aliases] of SIDO_ALIASES) {
    if (aliases.some((alias) => normalized.startsWith(alias))) return code;
  }
  for (const [code, alias] of SIDO_ONLY) {
    if (normalized.startsWith(alias)) return code;
  }
  return null;
}

/**
 * 시군구 라벨을 코드로 정규화한다. 행정구역 접미사(시·군·구)를 떼어
 * '경주시'→'경주', '해운대구'→'해운대', '달성군'→'달성' 로 만든다.
 * 접미사를 떼면 빈 문자열이 되는 값('시')은 null.
 *
 * 동명 시군구('중구'·'남구')는 코드도 같다 — 시도 코드와 함께 써야 유일해진다.
 * 검색은 시도 코드를 우선하므로(§destinationRegionFilter) 실제 혼동은 나지 않는다.
 */
export function toSigunguCode(label: string | null | undefined): string | null {
  if (!label) return null;
  const normalized = label.trim().replace(/\s+/g, '');
  const alias = SIGUNGU_ALIASES.find(([, aliases]) =>
    aliases.includes(normalized.toLowerCase()),
  );
  if (alias) return alias[0];
  const stripped = normalized.replace(/(특별자치시|자치시|시|군|구)$/, '');
  return stripped || null;
}

/**
 * 적재 시 행에 저장할 지역 코드를 만든다.
 *
 * **주소가 1순위** — 수집 라벨은 소스의 행정 구분을 그대로 받는데, KTO 시도 목록에는
 * 우리 17개 코드에 없는 통합 라벨('전남광주통합특별시')이 섞여 나온다. 그 라벨로 코드를
 * 정하면 실제로는 광주에 있는 장소가 전남으로 묶여 '광주' 검색에서 통째로 사라진다.
 * 장소의 주소는 그런 사정과 무관하게 실제 소재지를 말하므로 주소를 먼저 본다.
 *
 * 주소로 못 정하면 라벨로 폴백하고, 라벨이 시도로도 안 잡히면(seed 슬러그 'gyeongju' 처럼
 * 시군구 단위 라벨) 시군구 코드로 본다. 어느 쪽도 아니면(seed 의 'default') 둘 다 null —
 * 지역 라벨 없는 행으로 남아 어떤 목적지 검색에서도 후보로 살아 있는다(폴백 시드의 의도).
 */
export function placeRegionCodes(
  region: string | null | undefined,
  regionSigungu?: string | null,
  address?: string | null,
): { regionCode: SidoCode | null; sigunguCode: string | null } {
  const tokens = (address ?? '').trim().split(/\s+/).filter(Boolean);
  const addressSido = toSidoCode(tokens[0] ?? null);
  const addressSigungu = /[시군구]$/.test(tokens[1] ?? '') ? toSigunguCode(tokens[1]!) : null;

  const regionCode = addressSido ?? toSidoCode(region);
  const sigunguCode = addressSigungu ?? toSigunguCode(regionSigungu);
  if (regionCode) return { regionCode, sigunguCode };

  const fallbackSigungu = sigunguCode ?? toSigunguCode(region);
  return {
    regionCode: null,
    sigunguCode: fallbackSigungu === 'default' ? null : fallbackSigungu,
  };
}

export interface RegionFilter {
  /** 시도 코드. 목적지 첫 토큰이 시도로 해석되면 채워진다. */
  sido: SidoCode | null;
  /** 시군구 코드. 시도로 해석 안 되는 토큰(예: '경주')에서 뽑는다. */
  sigungu: string | null;
}

/**
 * 사용자 목적지 문자열에서 검색 pre-filter 에 쓸 지역 코드를 뽑는다.
 *
 * 시도가 잡히면 시도 하나로 필터한다 — '부산 해운대구' 여행이라도 후보 풀은 부산 전역이어야
 * 일정이 짜인다(시군구로 좁히면 이동 가능한 인접 후보가 통째로 사라진다).
 * 시도가 안 잡히는 목적지('경주')는 시군구 코드로 본다.
 * 둘 다 없으면(자유 입력·해외 등) 지역 필터 없이 전역 검색.
 */
export function destinationRegionFilter(destination: string): RegionFilter {
  const tokens = destination.trim().split(/\s+/).filter(Boolean);
  for (const token of tokens) {
    const sido = toSidoCode(token);
    if (sido) return { sido, sigungu: null };
  }
  const sigungu = toSigunguCode(tokens[0] ?? null);
  return { sido: null, sigungu };
}
