# 취향 사진 비공개화 — 버킷 분리 + 서명 URL (v1)

> 보안 점검 6번의 2단계. 1단계(탈퇴 시 오브젝트 삭제)는 앞선 커밋에서 처리했다.

## 무엇이 문제였나

취향 사진이 **영구 공개 URL** 로 열려 있었다. 처음엔 "`public/` 프리픽스만 익명 허용"으로
이해했지만, 라이브에서는 그보다 나빴다:

- `public/` 규칙은 **MinIO 전용 정책**이다(`mc anonymous set download local/tripick/public`).
  R2 에는 프리픽스 단위 접근 정책이 **없다**
- 라이브 버킷에는 `cdn.tripick.place` 커스텀 도메인이 붙어 있다 → **키를 아는 사람은 버킷
  전체를 읽는다.** 프리픽스는 아무 보호가 아니었다
- 사진은 본인만 보는 개인 사진인데, URL 이 한 번 새면(브라우저 히스토리·확장·화면 공유)
  영구 열람이 됐다

## 왜 버킷을 나눴나 (다른 방법을 안 쓴 이유)

| 방법 | 왜 안 됐나 / 왜 안 골랐나 |
|---|---|
| 프리픽스를 `private/` 로 옮김 | R2 에 프리픽스 정책이 없어 **프로덕션에서 아무 효과가 없다** |
| 커스텀 도메인 + presigned URL | Cloudflare 문서: "Presigned URLs work with the S3 API domain (`<ACCOUNT_ID>.r2.cloudflarestorage.com`) and **cannot be used with custom domains**." 서명 쿼리가 무시돼 그냥 공개 URL 이 된다 |
| Worker 를 cdn 앞에 두고 HMAC 검증 | 동작한다(Worker 가 캐시보다 먼저 실행되므로 인가를 건너뛴 응답이 안 나간다). 다만 **인가 로직이 API·Worker 두 곳**으로 갈리고 공유 시크릿·wrangler 배포가 늘어난다. 캐싱 이득도 작다 — 취향 사진은 본인 1명만 보는 자산이라 엣지 캐시가 값을 못 한다(게다가 서명 쿼리가 매번 달라 캐시 키를 따로 정규화해야 히트가 난다) |
| **비공개 버킷 분리 (채택)** | 인가가 API 한 곳에만 남고, 엣지 컴포넌트가 없다. 공개 자산(프로필 이미지)은 기존 CDN 경로 그대로 |

## 구조

```
STORAGE_BUCKET         = tripick           (공개, cdn.tripick.place 앞단)  → 프로필 이미지
STORAGE_PRIVATE_BUCKET = tripick-private   (비공개, 도메인 없음)          → 취향 사진
```

- 프로필 이미지는 그대로 공개다. 친구·여행 멤버에게 보여야 하고 사용자가 스스로 공개하는
  아바타라 성격이 다르다 — CDN 캐시도 계속 탄다
- 취향 사진은 `signedUrl()` 로 만든 **15분 만료** URL 로만 읽는다
- `STORAGE_PRIVATE_BUCKET` 이 없으면 취향 사진 업로드가 **503** 이다. 공개 버킷 폴백은 두지
  않았다 — 그 폴백이 곧 이 변경으로 막으려는 노출이다

### ⚠️ R2 설정 전제

- 비공개 버킷에 **커스텀 도메인을 붙이지 말 것** (붙는 순간 presigned 가 무의미해진다)
- 비공개 버킷의 **`r2.dev` 공개 개발 URL 을 끌 것.** Cloudflare 문서가 명시적으로 경고한다 —
  켜져 있으면 다른 보호를 붙여도 그 경로로 그대로 새어 나간다
- API 토큰이 두 버킷 모두 접근 가능해야 한다

## 식별자가 URL → 키로 바뀐 이유

표시용 URL 이 만료되는 서명 URL 이 되면서 **매번 값이 달라진다** → 식별자로 쓸 수 없다.
예전엔 한 문자열이 식별자 겸 표시용이었고, 그 문자열이 세 곳의 키였다:

- `preferences.photoUrls` 배열 값
- `photoTags` / `disabledPhotoTags` 의 **객체 키**
- 삭제·태그 토글 API 의 파라미터

그래서 정본 식별자를 **스토리지 키**로 돌리고, 표시용 URL 은 응답을 만들 때마다 새로 서명해
붙인다. 컬럼명은 `photoUrls` 로 남겼다(엔티티가 `name: 'photoUrls'` 로 매핑) — rename 을
피해 마이그레이션이 데이터만 건드리게 했다.

### 바뀐 계약

```ts
// 전
photoUrls: string[]                       // 식별자 = 표시용 = 공개 URL
TogglePhotoTagDto { url, tag, enabled }
DELETE /preference-analyzer/photos?url=…

// 후
photos: Array<{ key, url }>               // key=정본 식별자, url=15분 만료 표시용
TogglePhotoTagDto { key, tag, enabled }
DELETE /preference-analyzer/photos?key=…
```

`GET /preferences` 도 `photos` 를 내려준다 — 컨트롤러가 엔티티를 그대로 반환하던 동안은
`photoKeys` 만 나가서 화면이 이미지를 못 그렸다(실제로 이 버그를 앱 띄워서 잡았다).

## 로컬: `/storage-private` 프록시와 host 함정

로컬·웹뷰는 절대 URL 이 기기 자신을 가리켜서 web 프록시를 타야 한다. 공개 프록시
(`/storage`)의 rewrite 목적지에 버킷 이름이 박혀 있어 경로를 분리했다:

```
/storage/:path*          → http://127.0.0.1:9000/tripick/:path*
/storage-private/:path*  → http://127.0.0.1:9000/tripick-private/:path*
```

`StorageService.PRIVATE_PROXY_PATH` 와 **짝**이므로 한쪽만 바꾸면 이미지가 404 난다.

### ⚠️ 서명 host == 프록시 목적지 host

SigV4 는 host 를 서명에 포함한다(`X-Amz-SignedHeaders=host`). 실측 결과:

| 서명 host | 프록시 목적지 | 결과 |
|---|---|---|
| `127.0.0.1:9000` | `127.0.0.1:9000` | **200** |
| `localhost:9000` | `127.0.0.1:9000` | **403 SignatureDoesNotMatch** |

`.env.example` 의 `STORAGE_ENDPOINT` 기본값이 `localhost:9000` 이라 원래 어긋나 있었다 —
`127.0.0.1:9000` 으로 맞췄다. 이 값을 바꿀 때는 web 의 `TRIPICK_STORAGE_ORIGIN` /
`TRIPICK_PRIVATE_STORAGE_ORIGIN` 과 host 를 함께 맞춰야 한다.

또한 **web 의 rewrite 는 빌드 시점에 박힌다** — `next start` 에 env 를 줘도 안 바뀐다.
스토리지 오리진을 바꾸려면 web 을 다시 빌드해야 한다.

## 배포 순서 (틀리면 사진이 깨진다)

```bash
# 0) R2: tripick-private 버킷 생성. 커스텀 도메인 X, r2.dev X
#    Railway/Vercel 환경변수에 STORAGE_PRIVATE_BUCKET 추가

# 1) 오브젝트 이전 (먼저!)  — dry-run 으로 대상 확인 후 apply
pnpm --filter @tripick/api migrate:photo-objects            # dry-run
pnpm --filter @tripick/api migrate:photo-objects -- --apply

# 2) DB 식별자 URL → 키
pnpm --filter @tripick/api migration:run

# 3) API·web 배포
```

**순서가 반대면** DB 는 새 위치를 가리키는데 오브젝트가 아직 옛 위치에 있어 사진이 전부
깨진다. 스크립트는 멱등하고(이미 옮겨진 건 건너뜀) 복사 검증 후에만 원본을 지운다.

되돌리기: `migrate:photo-objects -- --apply --revert` → `migration:run` 대신
`migration:revert`. 단 절대 URL 이었던 값은 상대경로(`/storage/public/...`)로 복원된다 —
도메인 정보가 키에 남아 있지 않다.

## 검증한 것

- **실제 앱**(`run-tripick` 드라이버): 사진 업로드 → 취향 화면에서 썸네일·저장된 사진 행
  양쪽에 정상 렌더. 서명 URL 이 `/storage-private` 프록시로 완주하는 것을 스크린샷으로 확인
- 서명 있으면 **200**, 서명 쿼리를 떼면 **403**, 옛 공개 경로는 **404**
- 로컬 MinIO 익명 접근: `tripick-private/` → **403** (익명 정책 없음)
- 마이그레이션: 빈 DB up → 절대 URL·상대경로 둘 다 키로 변환 → down 으로 URL 복원 →
  재적용 멱등 확인
- 이전 스크립트: 격리 버킷(`probe-src`/`probe-dst`)에서 apply·멱등·revert 확인.
  **사용자 로컬 데이터에는 apply 하지 않았다** — dry-run 이 기존 사진 11건을 잡았으므로
  실행은 사용자가 판단할 일이다
- 유닛·e2e: API 904 · utils 69 · e2e 81 통과
