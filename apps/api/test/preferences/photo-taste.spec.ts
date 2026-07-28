/// <reference types="jest" />

import type { TasteTagDto, TasteTagValue } from '@tripick/types';
import {
  buildPhotoTagsView,
  effectivePhotoTags,
  pruneToPhotos,
  tagsOf,
  toggleDisabledTag,
} from '../../src/preferences/photo-taste';

function tags(partial: Partial<TasteTagDto> = {}): TasteTagDto {
  return { food: [], mood: [], environment: [], confidence: 0, ...partial };
}

describe('effectivePhotoTags', () => {
  it('excludes tags the user turned off', () => {
    const result = effectivePhotoTags({
      photoUrls: ['a'],
      photoTags: { a: tags({ food: ['cafe'], mood: ['healing'], confidence: 0.8 }) },
      disabledPhotoTags: { a: ['healing'] },
    });

    expect(result).toEqual([tags({ food: ['cafe'], mood: [], confidence: 0.8 })]);
  });

  it('keeps the analysis result intact so re-enabling restores it', () => {
    const photoTags = { a: tags({ food: ['cafe'], confidence: 0.8 }) };
    effectivePhotoTags({ photoUrls: ['a'], photoTags, disabledPhotoTags: { a: ['cafe'] } });

    // 원본은 그대로여야 다시 켰을 때 살아난다
    expect(photoTags.a.food).toEqual(['cafe']);
  });

  it('turns a photo into a no-signal entry when every tag is off', () => {
    const result = effectivePhotoTags({
      photoUrls: ['a'],
      photoTags: { a: tags({ food: ['cafe'], confidence: 0.8 }) },
      disabledPhotoTags: { a: ['cafe'] },
    });

    expect(result[0]?.food).toEqual([]);
  });

  it('skips photos that are no longer stored', () => {
    const result = effectivePhotoTags({
      photoUrls: ['a'],
      photoTags: { a: tags({ food: ['cafe'] }), gone: tags({ food: ['korean'] }) },
      disabledPhotoTags: {},
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.food).toEqual(['cafe']);
  });
});

describe('toggleDisabledTag', () => {
  it('turns a tag off by adding it to the disabled list', () => {
    expect(toggleDisabledTag({}, 'a', 'cafe', false)).toEqual({ a: ['cafe'] });
  });

  it('turns a tag back on by removing it', () => {
    expect(toggleDisabledTag({ a: ['cafe', 'healing'] }, 'a', 'cafe', true)).toEqual({
      a: ['healing'],
    });
  });

  it('drops the photo key once every tag is back on', () => {
    expect(toggleDisabledTag({ a: ['cafe'] }, 'a', 'cafe', true)).toEqual({});
  });

  it('does not duplicate an already disabled tag', () => {
    expect(toggleDisabledTag({ a: ['cafe'] }, 'a', 'cafe', false)).toEqual({ a: ['cafe'] });
  });

  it('leaves other photos untouched', () => {
    const result = toggleDisabledTag({ a: ['cafe'], b: ['healing'] }, 'a', 'korean', false);
    expect(result.b).toEqual(['healing']);
  });
});

describe('buildPhotoTagsView', () => {
  it('reports each analyzed tag with its on/off state', () => {
    const view = buildPhotoTagsView({
      photoUrls: ['a'],
      photoTags: { a: tags({ food: ['cafe'], mood: ['healing'], environment: ['beach'] }) },
      disabledPhotoTags: { a: ['healing'] },
    });

    expect(view).toEqual([
      {
        url: 'a',
        analyzed: true,
        tags: [
          { tag: 'cafe', enabled: true },
          { tag: 'healing', enabled: false },
          { tag: 'beach', enabled: true },
        ],
      },
    ]);
  });

  it('returns an empty tag list for a photo with no analysis yet', () => {
    const view = buildPhotoTagsView({
      photoUrls: ['pending'],
      photoTags: {},
      disabledPhotoTags: {},
    });

    // 화면이 "취향 없음" 과 "아직 분석 안 됨" 을 구분해야 해서 analyzed 를 따로 내린다
    expect(view).toEqual([{ url: 'pending', analyzed: false, tags: [] }]);
  });

  it('marks an analyzed photo that produced no tags as analyzed', () => {
    const view = buildPhotoTagsView({
      photoUrls: ['empty'],
      photoTags: { empty: tags() },
      disabledPhotoTags: {},
    });

    expect(view).toEqual([{ url: 'empty', analyzed: true, tags: [] }]);
  });
});

describe('tagsOf', () => {
  it('lists tags in food → mood → environment order', () => {
    const result = tagsOf(
      tags({ food: ['cafe'], mood: ['healing'], environment: ['beach', 'nature'] }),
    );
    expect(result).toEqual<TasteTagValue[]>(['cafe', 'healing', 'beach', 'nature']);
  });

  it('drops values outside the known vocabulary', () => {
    const result = tagsOf(tags({ food: ['pizza' as never], mood: ['healing'] }));
    expect(result).toEqual(['healing']);
  });
});

describe('pruneToPhotos', () => {
  it('keeps only entries for live photos', () => {
    expect(pruneToPhotos({ a: 1, gone: 2 }, ['a'])).toEqual({ a: 1 });
  });
});
