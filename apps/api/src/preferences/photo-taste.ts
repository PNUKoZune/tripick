import {
  ENVIRONMENT_PREFERENCES,
  FOOD_PREFERENCES,
  MOOD_PREFERENCES,
  type EnvironmentPreference,
  type FoodPreference,
  type MoodPreference,
  type PreferencePhotoTagsDto,
  type TasteTagDto,
  type TasteTagValue,
} from '@tripick/types';

/**
 * 사진별 취향 태그를 다루는 순수 함수 모음.
 *
 * 분석 잡·사진 삭제·태그 on/off 세 경로가 모두 "살아있는 사진의, 꺼지지 않은 태그"로
 * 다시 집계해야 해서 한곳에 모았다.
 */

export interface PhotoTasteState {
  /** 스토리지 키 목록. 태그 맵의 key 와 같은 값이다. */
  photoKeys: string[];
  photoTags: Record<string, TasteTagDto>;
  disabledPhotoTags: Record<string, TasteTagValue[]>;
}

/** 사진 한 장에서 꺼진 태그를 제외한 결과. 축 구성은 유지한다. */
function withoutDisabled(tags: TasteTagDto, disabled: readonly TasteTagValue[]): TasteTagDto {
  if (disabled.length === 0) return tags;
  const off = new Set<string>(disabled);
  return {
    food: tags.food.filter((tag) => !off.has(tag)),
    mood: tags.mood.filter((tag) => !off.has(tag)),
    environment: tags.environment.filter((tag) => !off.has(tag)),
    confidence: tags.confidence,
  };
}

/**
 * 집계에 넣을 사진별 태그 목록.
 * 저장된 사진 목록에 없는 항목은 제외하고, 사용자가 끈 태그는 빼고 돌려준다.
 */
export function effectivePhotoTags(state: PhotoTasteState): TasteTagDto[] {
  return state.photoKeys
    .filter((key) => state.photoTags[key])
    .map((key) => withoutDisabled(state.photoTags[key] as TasteTagDto, state.disabledPhotoTags[key] ?? []));
}

/** 살아있는 사진 것만 남기고 나머지 키는 버린다 (사진 삭제 후 정리용). */
export function pruneToPhotos<T>(
  record: Record<string, T>,
  photoKeys: readonly string[],
): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([key]) => photoKeys.includes(key)));
}

/** 사진에서 뽑힌 태그를 축 순서(food → mood → environment)대로 나열한다. */
export function tagsOf(tags: TasteTagDto): TasteTagValue[] {
  return [
    ...tags.food.filter((tag): tag is FoodPreference => FOOD_PREFERENCES.includes(tag)),
    ...tags.mood.filter((tag): tag is MoodPreference => MOOD_PREFERENCES.includes(tag)),
    ...tags.environment.filter((tag): tag is EnvironmentPreference =>
      ENVIRONMENT_PREFERENCES.includes(tag),
    ),
  ];
}

/**
 * 프론트에 내려줄 사진별 태그 on/off 목록.
 *
 * `urlByKey` 는 표시용 서명 URL 맵이다 — 서명은 만료되므로 이 함수가 불릴 때마다 새로
 * 만들어 주입한다(DB 에 저장하지 않는다). 서명에 실패한 키는 빈 문자열로 남겨, 목록에서
 * 사라지는 대신 그 자리에 이미지가 안 뜨는 형태가 되게 한다(태그 편집은 계속 가능).
 */
export function buildPhotoTagsView(
  state: PhotoTasteState,
  urlByKey: ReadonlyMap<string, string> = new Map(),
): PreferencePhotoTagsDto[] {
  return state.photoKeys.map((key) => {
    const analyzed = state.photoTags[key];
    const off = new Set<string>(state.disabledPhotoTags[key] ?? []);
    return {
      key,
      url: urlByKey.get(key) ?? '',
      tags: analyzed
        ? tagsOf(analyzed).map((tag) => ({ tag, enabled: !off.has(tag) }))
        : [],
      // 태그가 없는 사진은 두 가지다 — 분석했으나 취향이 안 나온 것과, 아직 분석 안 된 것.
      analyzed: Boolean(analyzed),
    };
  });
}

/**
 * 특정 사진의 특정 태그를 켜고 끈 뒤 갱신된 비활성 목록을 돌려준다.
 * 켜는 것은 목록에서 빼는 것이고, 끄는 것은 넣는 것이다.
 */
export function toggleDisabledTag(
  disabled: Record<string, TasteTagValue[]>,
  url: string,
  tag: TasteTagValue,
  enabled: boolean,
): Record<string, TasteTagValue[]> {
  const current = disabled[url] ?? [];
  const next = enabled ? current.filter((item) => item !== tag) : [...new Set([...current, tag])];
  const updated = { ...disabled };
  // 전부 켜진 사진은 키를 남기지 않는다 — 빈 배열이 쌓이지 않게.
  if (next.length === 0) {
    delete updated[url];
  } else {
    updated[url] = next;
  }
  return updated;
}
