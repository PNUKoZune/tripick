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
      photoKeys: ['a'],
      photoTags: { a: tags({ food: ['cafe'], mood: ['healing'], confidence: 0.8 }) },
      disabledPhotoTags: { a: ['healing'] },
    });

    expect(result).toEqual([tags({ food: ['cafe'], mood: [], confidence: 0.8 })]);
  });

  it('keeps the analysis result intact so re-enabling restores it', () => {
    const photoTags = { a: tags({ food: ['cafe'], confidence: 0.8 }) };
    effectivePhotoTags({ photoKeys: ['a'], photoTags, disabledPhotoTags: { a: ['cafe'] } });

    // 원본은 그대로여야 다시 켰을 때 살아난다
    expect(photoTags.a.food).toEqual(['cafe']);
  });

  it('turns a photo into a no-signal entry when every tag is off', () => {
    const result = effectivePhotoTags({
      photoKeys: ['a'],
      photoTags: { a: tags({ food: ['cafe'], confidence: 0.8 }) },
      disabledPhotoTags: { a: ['cafe'] },
    });

    expect(result[0]?.food).toEqual([]);
  });

  it('skips photos that are no longer stored', () => {
    const result = effectivePhotoTags({
      photoKeys: ['a'],
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
  // 표시용 URL 은 만료되는 서명 URL 이라 DB 에 없다 — 응답을 만들 때마다 주입한다.
  it('주입된 서명 URL 을 키에 짝지어 내린다', () => {
    const view = buildPhotoTagsView(
      { photoKeys: ['k1', 'k2'], photoTags: {}, disabledPhotoTags: {} },
      new Map([
        ['k1', '/storage-private/k1?sig=1'],
        ['k2', '/storage-private/k2?sig=2'],
      ]),
    );

    expect(view.map((photo) => [photo.key, photo.url])).toEqual([
      ['k1', '/storage-private/k1?sig=1'],
      ['k2', '/storage-private/k2?sig=2'],
    ]);
  });

  // 서명 실패를 목록에서 빼면 사진이 사라진 것처럼 보여 사용자가 다시 올려 중복이 쌓인다.
  it('서명이 없는 키도 목록에 남긴다 (빈 URL)', () => {
    const view = buildPhotoTagsView(
      { photoKeys: ['k1', 'k2'], photoTags: {}, disabledPhotoTags: {} },
      new Map([['k1', '/storage-private/k1?sig=1']]),
    );

    expect(view).toHaveLength(2);
    expect(view[1]).toMatchObject({ key: 'k2', url: '' });
  });

  it('reports each analyzed tag with its on/off state', () => {
    const view = buildPhotoTagsView({
      photoKeys: ['a'],
      photoTags: { a: tags({ food: ['cafe'], mood: ['healing'], environment: ['beach'] }) },
      disabledPhotoTags: { a: ['healing'] },
    });

    expect(view).toEqual([
      {
        key: 'a',
        // 표시용 URL 은 주입받는다 — 안 주면 빈 문자열(이미지만 안 뜨고 태그 편집은 가능).
        url: '',
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
      photoKeys: ['pending'],
      photoTags: {},
      disabledPhotoTags: {},
    });

    // 화면이 "취향 없음" 과 "아직 분석 안 됨" 을 구분해야 해서 analyzed 를 따로 내린다
    expect(view).toEqual([{ key: 'pending', url: '', analyzed: false, tags: [] }]);
  });

  it('marks an analyzed photo that produced no tags as analyzed', () => {
    const view = buildPhotoTagsView({
      photoKeys: ['empty'],
      photoTags: { empty: tags() },
      disabledPhotoTags: {},
    });

    expect(view).toEqual([{ key: 'empty', url: '', analyzed: true, tags: [] }]);
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
