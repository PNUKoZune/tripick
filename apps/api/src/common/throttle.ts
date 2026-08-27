/**
 * `@Throttle` 에 넘길 분당 한도 헬퍼.
 *
 * 전역 기본은 60초당 120요청(app.module)인데, 그건 목록·조회 기준의 값이다. 한 번에
 * LLM 추론이나 외부 API 쿼터를 태우는 라우트는 그 한도 안에서도 충분히 비용을 낸다 —
 * 여행 생성 하나가 일정 전체를 LLM 으로 만들고, 사진 업로드 하나가 vision 추론 3건을
 * 부른다. 그래서 비싼 라우트는 개별 한도를 따로 붙인다.
 *
 * ⚠️ 추적 키는 **IP** 다. 전역 ThrottlerGuard 가 컨트롤러의 JwtAuthGuard 보다 먼저 돌아
 * `req.user` 가 아직 비어 있어서 사용자 단위로 셀 수 없다. 그래서 한도는 "한 사람이 쓸 만한
 * 양"이 아니라 "공유 IP(회사·이동통신 NAT) 뒤 여러 사람이 써도 안 막힐 양"으로 잡는다 —
 * 비용 상한은 LLM 응답 시간(건당 15~40초)이 이미 직렬화로 걸어 준다.
 */
export const perMinute = (limit: number) => ({ default: { limit, ttl: 60_000 } });

/** 일정 전체를 LLM 으로 생성하는 라우트(여행 생성·재계획). 응답 자체가 수십 초라 사실상 직렬. */
export const LLM_GENERATION_LIMIT = perMinute(5);

/** vision 추론을 부르는 사진 업로드·재분석. 1회 업로드가 최대 3장(각 10MB)이다. */
export const VISION_UPLOAD_LIMIT = perMinute(5);

/** CRAG 검색 + 네이버·카카오 외부 호출이 붙는 읽기. 사용자가 몇 번 눌러볼 수 있어 넉넉히. */
export const RETRIEVAL_READ_LIMIT = perMinute(20);

/** 카카오 로컬 단건 조회. 입력 폼에서 확인용으로 반복 호출된다. */
export const PLACE_LOOKUP_LIMIT = perMinute(30);
