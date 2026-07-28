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
  const latDelta = (from.lat - to.lat) * 111;
  const lngDelta = (from.lng - to.lng) * 88;
  return Math.sqrt(latDelta ** 2 + lngDelta ** 2);
}

function isNearDuplicate(a: Normalized, b: Normalized): boolean {
  if (a.stripped === b.stripped) return true;
  const [shorter, longer] =
    a.compact.length <= b.compact.length ? [a.compact, b.compact] : [b.compact, a.compact];
  if (shorter.length < MIN_CONTAINMENT_LENGTH) return false;
  if (!longer.includes(shorter)) return false;
  if (a.place.category !== b.place.category) return false;
  return distanceKm(a.place.coordinates, b.place.coordinates) <= CONTAINMENT_MAX_KM;
}

/**
 * 근접 중복 후보를 접는다. 입력은 **점수 내림차순**을 전제한다.
 *
 * 무리에서 남기는 대표는 "가장 높은 점수"가 아니라 **가장 짧은 이름**이다 — 일정 카드에 올릴
 * 이름으로 '국립경주박물관 어린이박물관'보다 '국립경주박물관'이 맞고, '한라산국립공원'보다
 * '한라산'이 맞다. 점수는 동률일 때만 본다(먼저 온 쪽). 대표는 자기 원래 순위 자리에 남으므로
 * 반환 목록은 입력의 점수 정렬을 그대로 유지한다.
 *
 * 무리 짓기는 **전이적**이다 — 특별전시관·어린이박물관은 서로를 포함하지 않지만 둘 다
 * '국립경주박물관'을 포함해 한 무리가 된다. 이름이 짧은 대표가 남으므로 전이로 무리가 커져도
 * 결과가 엉뚱해지지 않는다.
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

  // 무리 번호(union-find 없이 단순 병합 — 후보 수가 수백 단위라 O(n²) 로 충분).
  const groupOf = normalized.map((_, index) => index);
  const mergeInto = (from: number, to: number): void => {
    for (let i = 0; i < groupOf.length; i += 1) {
      if (groupOf[i] === from) groupOf[i] = to;
    }
  };
  for (let i = 0; i < normalized.length; i += 1) {
    for (let j = 0; j < i; j += 1) {
      if (groupOf[i] === groupOf[j]) continue;
      if (isNearDuplicate(normalized[i]!, normalized[j]!)) mergeInto(groupOf[i]!, groupOf[j]!);
    }
  }

  const representative = new Map<number, number>();
  normalized.forEach((item, index) => {
    const group = groupOf[index]!;
    const current = representative.get(group);
    if (current === undefined || item.compact.length < normalized[current]!.compact.length) {
      representative.set(group, index);
    }
  });

  const keptIndexes = new Set(representative.values());
  return candidates.filter((_, index) => keptIndexes.has(index));
}
