import type { Coordinates } from '@tripick/types';
import { regionSearchStem } from './place-seeds';

/**
 * **같은 장소를 가리키는 후보끼리 16칸을 나눠 쓰는 문제**를 검색 결과 단계에서 접는다.
 *
 * 적재 파이프라인엔 이름+좌표 dedupe 가 있지만 그건 **한 번의 적재 실행 안에서만** 돌고,
 * ID(kakao_place_id)가 다르면 다른 행으로 들어온다. 그래서 카탈로그에 실제로 이런 게 있다:
 *   - `한라산` ×2 (제주시·서귀포시 등록, 1.9km 떨어진 다른 kakao id)
 *   - `광주양동시장` / `광주 양동시장` (공백만 다름), `경포해수욕장` ×2 (좌표까지 동일)
 *   - `황리단길` / `경주 황리단길`, `첨성대` / `경주 첨성대` (지역명 접두만 다름)
 *   - `국립경주박물관` / `국립경주박물관 특별전시관` / `국립경주박물관 어린이박물관` (3칸)
 *   - `한라산` / `한라산국립공원` / `한라산 동능`, `속초아이` / `속초아이 대관람차`
 *
 * 골든셋 11케이스 상위 16칸 실측에서 이렇게 낭비되는 자리가 케이스당 1~4칸이었다.
 * evaluator 의 기존 dedupe(ID·이름+주소 완전일치)는 하나도 잡지 못한다.
 *
 * 판정은 두 규칙이고 **근거가 서로 다르다**.
 *   ① 이름이 같으면(지역명 접두·공백 무시) 거리·카테고리를 안 본다 — 사용자가 카드에서 보는
 *      건 이름뿐이라, 똑같은 이름 두 장은 좌표가 무엇이든 "고를 수 없는 후보"다.
 *   ② 이름이 한쪽을 포함하면 근처(2km)이고 카테고리가 같을 때만 접는다 — '이순신광장'과
 *      '카페모카 힐 이순신광장점' 처럼 **명소 이름을 딴 가게**가 통째로 사라지면 안 되므로
 *      카테고리가 방어선이고, 2km 는 산처럼 입구가 여러 개인 장소를 잡기 위한 폭이다
 *      (`한라산`↔`한라산 동능` 1.84km. 반대로 `한라산1100고지` 7.3km 는 살아남는다).
 */

/** 포함 관계로 접을 최대 거리(km). 위 §② 참고 — 한라산 동능 1.84km 가 하한 근거. */
const CONTAINMENT_MAX_KM = 2;

/**
 * **카탈로그 행 수준**에서 같은 물리적 장소로 볼 최대 거리(m). 위 §② 의 2km(검색 결과에서
 * 이름 포함 관계를 접는 폭)와 목적이 다르다 — 이 값은 "이름이 같고 이만큼 가까우면 한 장소이니
 * 행을 두 개 만들지 않는다"는 적재 판정이라 훨씬 보수적이어야 한다.
 *
 * 250m 근거 — 카탈로그 실측에서 이름이 같은 쌍 376개의 거리 분포는 0~100m 114쌍, 100~200m 24,
 * 200~300m 10, 300~400m 11, 400~500m 8, 500m 초과 209였다. 400m 까지는 **전부 소스 교차**
 * (한쪽 KTO·한쪽 카카오)로 같은 장소를 다르게 지오코딩한 것이고(대전오월드 311m,
 * 국립중앙과학관 381m 처럼 넓은 시설의 입구 vs 중심), 400m 를 넘어서면 교차 비율이 떨어지며
 * 500m 초과 209쌍은 도시마다 있는 동명 장소('중앙시장' 등)다. 즉 무릎은 400m 부근이지만,
 * 잘못 합치면 실재하는 장소가 사라지는 방향이라 KTO 이름 검색 매칭과 같은 250m 를 쓴다
 * (남는 100~400m 잔여는 검색 단계의 collapseNearDuplicates 가 접어 사용자에게는 안 보인다).
 */
export const SAME_PLACE_RADIUS_M = 250;

/** 카탈로그 이름 비교용 정규화(공백 제거·소문자). 적재 dedupe·정리 CLI·SQL 이 같은 규칙을 쓴다. */
export function normalizeCatalogName(name: string): string {
  return compactName(name);
}

/**
 * 평면 근사 상수. 위도 1도=111km, 경도 1도≈88km(위도 37.5° 보정).
 * 앵커 반경 bbox(`place-embedding.repository`)도 이 값으로 만든다 — 거리 판정이 여러 곳에
 * 흩어져 있어도 같은 근사식을 써야 경계에서 결과가 갈리지 않는다.
 */
export const KM_PER_LAT_DEGREE = 111;
export const KM_PER_LNG_DEGREE = 88;

/**
 * 두 좌표의 거리(m). 위도 1도=111km, 경도 1도≈88km(위도 37.5° 보정) 평면 근사 —
 * 국내 단거리에서 오차 1% 미만이고, place-embedding.repository 의 SQL 이 같은 식을 쓴다
 * (같은 판정이 JS·SQL 두 곳에서 갈리지 않게 하려면 근사식도 같아야 한다).
 */
export function metersBetween(from: Coordinates, to: Coordinates): number {
  return distanceKm(from, to) * 1000;
}

/**
 * 포함 관계 판정에 요구하는 최소 이름 길이(공백 제거). 2글자 이름은 우연한 포함이 흔하다
 * — 카페 '담다'·'연다' 가 '연다방' 을 삼키는 식이라, 인지도 매칭의 `MIN_COUNTABLE_LENGTH`
 * 와 같은 3자 하한을 쓴다. **4로 올리면 안 된다** — '한라산'(3자)이 '한라산국립공원'을
 * 못 잡아 이 작업의 원래 케이스가 빠진다.
 */
const MIN_CONTAINMENT_LENGTH = 3;

export interface NearDuplicateCandidate {
  name: string;
  category: string;
  coordinates: Coordinates;
}

interface Normalized {
  place: NearDuplicateCandidate;
  /** 공백만 지운 이름 (포함 관계 판정용 — 이름 가운데 든 지역명은 고유명의 일부로 본다) */
  compact: string;
  /** 목적지 접두까지 뗀 이름 (동일 이름 판정용) */
  stripped: string;
}

function compactName(name: string): string {
  return name.replace(/\s+/g, '').toLowerCase();
}

/**
 * 비교용 이름에서 **선두** 목적지 토큰을 뗀다 ('경주 황리단길'→'황리단길').
 * 선두만 떼는 이유는 '국립경주박물관'의 '경주'처럼 이름 가운데 든 지역명은 고유명의 일부라서다.
 */
function stripRegionPrefix(compact: string, regionTokens: string[]): string {
  let result = compact;
  let changed = true;
  while (changed) {
    changed = false;
    for (const token of regionTokens) {
      if (token.length > 0 && result.length > token.length && result.startsWith(token)) {
        result = result.slice(token.length);
        changed = true;
      }
    }
  }
  return result;
}

function distanceKm(from: Coordinates, to: Coordinates): number {
  const latDelta = (from.lat - to.lat) * KM_PER_LAT_DEGREE;
  const lngDelta = (from.lng - to.lng) * KM_PER_LNG_DEGREE;
  return Math.sqrt(latDelta ** 2 + lngDelta ** 2);
}

/**
 * 기준 `base` 가 후보 `candidate` 를 흡수하는지. **방향이 있다** — candidate 가 base 를 품어야
 * 하고 그 반대는 아니다(§collapseNearDuplicates 의 다리 문제).
 */
function absorbs(base: Normalized, candidate: Normalized): boolean {
  if (base.stripped === candidate.stripped) return true;
  if (base.compact.length < MIN_CONTAINMENT_LENGTH) return false;
  if (!candidate.compact.includes(base.compact)) return false;
  if (base.place.category !== candidate.place.category) return false;
  return distanceKm(base.place.coordinates, candidate.place.coordinates) <= CONTAINMENT_MAX_KM;
}

/**
 * 근접 중복 후보를 접는다. 입력은 **점수 내림차순**을 전제한다.
 *
 * 무리에서 남기는 대표는 "가장 높은 점수"가 아니라 **가장 짧은 이름**이다 — 일정 카드에 올릴
 * 이름으로 '국립경주박물관 어린이박물관'보다 '국립경주박물관'이 맞고, '한라산국립공원'보다
 * '한라산'이 맞다. 점수는 동률일 때만 본다(먼저 온 쪽). 대표는 자기 원래 순위 자리에 남으므로
 * 반환 목록은 입력의 점수 정렬을 그대로 유지한다.
 *
 * 무리는 **"기준 이름 하나 + 그 이름을 품은 확장들"** 로만 짓는다. 특별전시관·어린이박물관은
 * 서로를 포함하지 않지만 둘 다 '국립경주박물관'을 품으므로 그 기준 아래 한 무리가 된다.
 *
 * ⚠️ **양방향 전이 병합이면 안 된다.** 예전 구현은 쌍끼리 포함 관계만 보고 union 했는데,
 * 긴 이름 하나가 서로 무관한 짧은 이름 둘을 이어 붙였다. 실측(속초):
 *
 *   속초해수욕장 ─┐
 *                 ├─ 속초해수욕장 대관람차(속초아이)   ← 둘을 잇는 다리
 *   속초아이     ─┘
 *
 * '속초해수욕장'과 '속초아이'는 서로를 포함하지 않는 **다른 장소**인데 한 무리가 되고, 가장 짧은
 * 이름 규칙이 대표를 '속초아이'(대관람차)로 뽑아 **해수욕장이 후보에서 통째로 사라졌다**
 * (골든셋 sokcho 정답 하나가 채점 풀에 아예 없었다).
 *
 * 그래서 접기는 **한 방향**이다 — 후보는 자기가 품고 있는 기준에만 접힌다. 기준을 이름이 짧은
 * 순으로 세우므로 대표는 여전히 가장 짧은 이름이고, 서로를 품지 않는 둘은 각자 기준으로 남는다.
 */
export function collapseNearDuplicates<T extends NearDuplicateCandidate>(
  candidates: T[],
  destination: string,
): T[] {
  const regionTokens = regionSearchStem(destination)
    .split(/\s+/)
    .map((token) => token.toLowerCase())
    .filter(Boolean);

  const normalized: Normalized[] = candidates.map((candidate) => {
    const compact = compactName(candidate.name);
    return { place: candidate, compact, stripped: stripRegionPrefix(compact, regionTokens) };
  });

  // 이름이 짧은 순으로 기준을 세운다. 길이가 같으면 입력 순서(점수 순)로 갈라 결정적으로 만든다.
  const byNameLength = normalized
    .map((item, index) => ({ item, index }))
    .sort((a, b) => a.item.compact.length - b.item.compact.length || a.index - b.index);

  const baseIndexes: number[] = [];
  const collapsed = new Set<number>();
  for (const { item, index } of byNameLength) {
    // 자기가 품고 있는 기준이 있으면 그 아래로 접힌다. 없으면 자기가 새 기준이 된다.
    const base = baseIndexes.find((baseIndex) => absorbs(normalized[baseIndex]!, item));
    if (base === undefined) baseIndexes.push(index);
    else collapsed.add(index);
  }

  return candidates.filter((_, index) => !collapsed.has(index));
}
