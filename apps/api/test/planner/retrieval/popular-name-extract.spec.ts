/// <reference types="jest" />

import {
  extractPlaceNameCandidates,
  isGenericPlaceName,
} from '../../../src/planner/retrieval/popular-name-extract';

/** 실제 네이버 블로그 스니펫 형태(마크업 제거·소문자화 후) 를 흉내낸 코퍼스. */
const CORPUS = [
  '서울 여행지 추천 남산서울타워 야경 보고 왔어요. 남산서울타워는 케이블카 타고 올라가면 편해요.',
  '서울 가볼만한 곳 정리! 남산서울타워, 롯데월드타워 전망대, 북촌한옥마을 다 좋았습니다.',
  '롯데월드타워 서울스카이 다녀왔습니다. 롯데월드타워에서 본 한강 풍경이 최고였어요.',
  '북촌한옥마을 산책 후기. 북촌한옥마을은 평일 오전이 한적해요.',
  '서울 여행 코스 추천 맛집 카페 총정리 진짜 너무 좋았어요.',
].join(' ');

describe('extractPlaceNameCandidates', () => {
  const candidates = extractPlaceNameCandidates(CORPUS, {
    limit: 20,
    excludeTokens: ['서울'],
  });
  const names = candidates.map((c) => c.name);

  it('surfaces landmark names that the catalog is missing', () => {
    expect(names).toContain('남산서울타워');
    expect(names).toContain('롯데월드타워');
    expect(names).toContain('북촌한옥마을');
  });

  it('ranks by mention frequency so 대표 명소 come first', () => {
    const top = names.slice(0, 3);
    expect(top).toContain('남산서울타워');
    expect(candidates[0]!.frequency).toBeGreaterThanOrEqual(candidates[1]!.frequency);
  });

  it('strips one trailing particle so 조사 붙은 언급도 같은 후보로 모인다', () => {
    // '남산서울타워' 1회 + '남산서울타워는' 1회 + '남산서울타워,' 1회 = 3
    expect(candidates.find((c) => c.name === '남산서울타워')?.frequency).toBe(3);
  });

  it('drops travel-blog boilerplate that would otherwise dominate by frequency', () => {
    for (const stopword of ['여행', '추천', '코스', '맛집', '카페', '총정리', '너무', '진짜']) {
      expect(names).not.toContain(stopword);
    }
  });

  it('drops inflected verb forms', () => {
    for (const inflected of ['왔어요', '좋았습니다', '다녀왔습니다', '좋았어요', '한적해요']) {
      expect(names).not.toContain(inflected);
    }
  });

  it('drops the region token itself (검색어가 "서울 서울" 이 되는 것 방지)', () => {
    expect(names).not.toContain('서울');
  });

  it('drops names mentioned only once (대표 장소가 아님)', () => {
    const once = extractPlaceNameCandidates('강릉 안목해변 다녀왔어요', { limit: 20 });
    expect(once.map((c) => c.name)).not.toContain('안목해변');
  });

  it('keeps names with digits mixed in (83타워)', () => {
    const mixed = extractPlaceNameCandidates('대구 83타워 야경, 83타워 전망대 추천', { limit: 20 });
    expect(mixed.map((c) => c.name)).toContain('83타워');
  });

  it('is deterministic on frequency ties', () => {
    const a = extractPlaceNameCandidates(CORPUS, { limit: 20 });
    const b = extractPlaceNameCandidates(CORPUS, { limit: 20 });
    expect(a).toEqual(b);
  });

  it('respects the limit', () => {
    expect(extractPlaceNameCandidates(CORPUS, { limit: 2 })).toHaveLength(2);
  });

  it('does not over-strip 주격 조사 ("나들이" 가 "나들" 로 잘리면 안 된다)', () => {
    // '나들'은 카카오에 실존 상호라 관문을 통과해 버렸던 실측 사례.
    const corpus = '서울 나들이 코스 추천. 봄 나들이 좋은 곳. 나들이 명소.';
    expect(extractPlaceNameCandidates(corpus, { limit: 20 }).map((c) => c.name)).not.toContain(
      '나들',
    );
  });
});

describe('isGenericPlaceName', () => {
  it('rejects SEO 상호 that Kakao really has registered', () => {
    // 실측에서 관문 ②를 통과했던 것들 (성동구 '서울맛집', 강서구 '놀만한곳' 등)
    for (const name of ['서울맛집', '신촌맛집', '놀만한곳', '만남의장소', '제주도여행코스']) {
      expect(isGenericPlaceName(name)).toBe(true);
    }
  });

  it('keeps real place names', () => {
    for (const name of ['남산서울타워', 'N서울타워', '성산일출봉', '설악산', '백촌막국수', '경포해수욕장']) {
      expect(isGenericPlaceName(name)).toBe(false);
    }
  });
});
