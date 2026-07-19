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
  photoUrls: string[];
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
  return state.photoUrls
    .filter((url) => state.photoTags[url])
    .map((url) => withoutDisabled(state.photoTags[url] as TasteTagDto, state.disabledPhotoTags[url] ?? []));
}

/** 살아있는 사진 것만 남기고 나머지 키는 버린다 (사진 삭제 후 정리용). */
export function pruneToPhotos<T>(
  record: Record<string, T>,
  photoUrls: readonly string[],
): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([url]) => photoUrls.includes(url)));
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

/** 프론트에 내려줄 사진별 태그 on/off 목록. */
export function buildPhotoTagsView(state: PhotoTasteState): PreferencePhotoTagsDto[] {
  return state.photoUrls.map((url) => {
    const analyzed = state.photoTags[url];
    const off = new Set<string>(state.disabledPhotoTags[url] ?? []);
    return {
      url,
      tags: analyzed
        ? tagsOf(analyzed).map((tag) => ({ tag, enabled: !off.has(tag) }))
        : [],
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
