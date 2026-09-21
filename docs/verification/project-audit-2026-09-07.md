**TriPick 전체 점검 — 2026-09-07 (수정 전 기록)**

이 문서는 수정 전 감사 결과다. 현재 PR의 조치·최종 검증·남은 과제는 [수정 및 검증 보고서](project-remediation-2026-09-07.md)를 기준으로 확인한다.

기준 커밋: `627cca5`. API·웹·모바일 소스, 인증·인가, 사진 저장소, 일정 변경·재계획, DB·큐, 의존성, 배포 설정을 검토했다. 기존 빌드·테스트가 모두 통과해도 권한 우회와 데이터 유실 경로가 남아 있다. 아래 A01~A08은 우선 수정 권장 사항이다. 애플리케이션 코드는 변경하지 않았다.

P1은 보안 경계·데이터 보존·배포에 영향을 주어 우선 수정할 문제, P2는 다음 수정 주기에 처리할 기능·성능·유지보수 문제다. 실제 운영 시스템에 침투 시험을 한 결과는 아니다. 재현은 로컬 임시 HTTP 서버, 직접 생성한 테스트 DB, 합성 사용자와 외부 의존성 대체 객체를 사용했다.

**검사 결과**

| 검사 | 결과 |
| --- | --- |
| `pnpm turbo run lint typecheck test --force` | 14개 작업 성공. 캐시 우회 |
| API 단위 테스트 | 73개 스위트, 928개 성공 |
| 공통 유틸 테스트 | 7개 스위트, 69개 성공 |
| API E2E | 별도 감사용 DB에서 6개 스위트, 81개 성공 |
| 기존 테스트 합계 | 1,078개 성공 |
| `pnpm turbo run build --force` | API·웹·공통 패키지 4개 빌드 성공 |
| 타입 검사 | API·웹·모바일·공통 패키지 통과 |
| ESLint | 오류 0개, 경고 263개(API 261, 웹 2) |
| DB 마이그레이션 | 빈 DB에 15개 적용, 재실행 0개, 최신 1개 rollback 후 재적용 성공 |
| 엔티티/마이그레이션 비교 | `users.notificationPreferences` 기본값 차이 1건 |
| 전체 의존성 audit | 공지 19건: High 13, Moderate 5, Low 1, Critical 0 |
| production 의존성 audit | 공지 6건: High 4, Moderate 2. 모바일 빌드 도구도 포함되므로 런타임 노출과 구분 필요 |
| 비밀정보 패턴 검색 | 추적 파일에서 점검한 개인키·AWS/GitHub/Google/Stripe 키 패턴의 일치 없음. 전체 이력·고엔트로피 문자열 검사는 아님 |
| 웹 HTTP | 로컬 production 서버 `/`, `/login` 200. framing·nosniff·referrer 헤더 확인 |

검사는 Node `26.7.0`, pnpm `9.12.0`에서 수행했다. 따라서 로컬 빌드 성공이 Docker의 Node 20 호환성을 보장하지 않는다(A08).

**우선 수정할 문제**

**A01 · P1 · 다른 사용자의 비공개 사진 키를 자기 취향에 등록할 수 있음**

- 위치: [DTO](../../apps/api/src/preferences/dto/preference.dto.ts#L138), [저장](../../apps/api/src/preferences/preferences.service.ts#L112), [서명 URL 응답](../../apps/api/src/preferences/preferences.controller.ts#L46), [사진 삭제](../../apps/api/src/preference-analyzer/preference-analyzer.controller.ts#L202).
- `PUT /preferences`의 `photoKeys`는 문자열 형식만 검사한다. 사용자 소유권이나 서버가 발급한 업로드 기록을 확인하지 않고 저장한 뒤, 그 키의 비공개 서명 URL을 반환한다.
- 삭제도 `current.includes(key)`만 확인하므로, 타인 키를 자기 목록에 먼저 넣으면 타인 객체가 삭제 대상이 된다. 탈퇴 정리와 사진 재분석도 이 목록을 신뢰한다.
- **재현:** 합성 사용자 A의 요청에 합성 사용자 B의 `preferences/<B UUID>/<timestamp>-0.jpg`를 넣었다. DTO 오류 0개였고, B의 키가 서명 함수와 비공개 삭제 함수에 전달됐다. 실제 타인 객체는 읽거나 삭제하지 않았다.
- **영향:** 키를 아는 인증 사용자가 사진 읽기·삭제 경계를 우회한다. 버킷을 비공개로 만든 것만으로 막히지 않는다.
- **수정:** 일반 취향 DTO에서 `photoKeys` 수정 권한을 제거하고, 업로드 기록의 `ownerId`로 검증한다. 서명·분석·삭제·탈퇴 정리에서도 소유권을 확인한다. 기존 데이터에 타인 키가 섞였는지도 확인해야 한다.

**A02 · P1 · 장소 링크 해석의 SSRF 및 응답 크기 무제한**

- 위치: [입력 경로](../../apps/api/src/main-planner/main-planner.service.ts#L326), [HTTP 요청](../../apps/api/src/main-planner/main-planner.service.ts#L1279).
- `resolve-place`가 받은 모든 HTTP(S) URL에 서버가 `axios.get`을 실행한다. 호스트·내부 IP 제한이 없고 리다이렉트 5회도 그대로 따른다. 최종 URL만 필요하면서 본문 크기 상한도 없다.
- **재현:** 감사용 `127.0.0.1` 임시 서버에 실제 요청이 1회 도착했다. 운영 내부망이나 메타데이터 서비스에는 요청하지 않았다.
- **영향:** 로그인한 여행 소유자·참여자가 API 서버의 내부망 접근 권한을 사용해 요청할 수 있다. 큰 응답으로 메모리를 소비할 수도 있다. 응답 본문 유출까지 재현한 것은 아니다.
- **수정:** 지원하는 지도 링크만 허용한다. URL에서 키워드를 바로 추출할 수 있으면 네트워크 호출을 생략한다. 단축 링크는 매 리다이렉트·DNS 해석 시 사설/루프백/link-local 주소를 차단하고, 응답 크기·시간을 제한한다.

**A03 · P1 · 참여자가 소유자 승인 없이 AI 재계획 실행 가능**

- 위치: [인가](../../apps/api/src/replanning/replanning.service.ts#L37), [일반 라우트](../../apps/api/src/replanning/replanning.controller.ts#L23), [대체 라우트](../../apps/api/src/alternative/alternative.controller.ts#L21), [웹 승인 분기](../../apps/web/src/features/request-replan/model/use-request-replan.ts#L32).
- 웹은 비소유자의 변경을 제안으로 보내지만, 서버 `enqueue`는 `canAccessTrip`으로 조회 가능한 멤버인지 확인할 뿐이다. `/replanning`, `/alternative/request`, `/alternative/deviation` 직접 호출로 승인 절차를 건너뛴다.
- **재현:** 실제 멤버 권한 함수를 사용해 `accepted` 상태의 companion으로 호출했다. 소유자 승인 없이 큐 등록이 성공했다. 실제 AI 작업은 실행하지 않았다.
- **수정:** 실행 서비스에서 소유자 권한을 강제한다. 승인된 제안을 실행하는 경로는 승인 기록을 함께 검증한다. 요청자·여행·승인 관계가 큐 등록과 작업 실행 양쪽에서 유지되어야 한다.

**A04 · P1 · 비밀번호 재설정·변경 뒤 기존 access token이 계속 유효**

- 위치: [비밀번호 재설정](../../apps/api/src/auth/auth.service.ts#L246), [refresh 폐기](../../apps/api/src/auth/auth.service.ts#L581), [JWT 검증](../../apps/api/src/auth/strategies/jwt.strategy.ts#L27), [기본 수명](../../apps/api/src/auth/auth.module.ts#L30).
- 폐기하는 것은 refresh token뿐이다. access token에는 사용자 ID만 담고, 검증도 사용자 존재 여부만 본다. 기본 수명은 7일이다. 로그아웃도 access token을 폐기하지 않는다.
- **재현:** 실제 JWT를 발급한 후 재설정 로직을 실행했다. refresh 폐기 함수가 호출된 뒤에도 기존 토큰이 JWT 검증과 `JwtStrategy.validate`를 통과했다. 설정상 TTL은 604,800초였다.
- **영향:** 탈취 토큰을 비밀번호 변경으로 차단할 수 없고, 기존 기기의 API 접근이 최대 잔여 수명만큼 이어진다.
- **수정:** `sessionVersion` 또는 세션 식별자를 검증하고 비밀번호 변경 시 갱신/폐기한다. access 수명도 짧게 조정하되 네이티브 위치 보고의 갱신 흐름을 함께 구현해야 한다. WebSocket도 폐기·만료 시 연결을 종료해야 한다.

**A05 · P1 · 카카오 이메일의 검증 상태를 확인하지 않고 기존 계정에 연결**

- 위치: [카카오 응답 변환](../../apps/api/src/auth/auth.service.ts#L777), [기존 계정 검색](../../apps/api/src/users/users.service.ts#L89), [이메일 기반 병합](../../apps/api/src/users/users.service.ts#L101).
- `is_email_valid`, `is_email_verified`를 읽지 않고 이메일 문자열만 신뢰한다. 일치하는 기존 계정에 카카오 ID를 저장하고 이메일 인증 시각도 채운다.
- **재현:** `is_email_valid=true`, `is_email_verified=false`인 합성 카카오 응답에서도 기존 이메일 계정에 연결됐다. 공급자 응답은 대체했으며, 실제 카카오 계정 탈취 시험은 하지 않았다.
- **영향:** 미검증 이메일이 반환되는 경우 계정 연결을 잘못 신뢰할 수 있다. 카카오도 이메일의 유효성·인증 상태 확인을 요구하고, 이메일만으로 동일 사용자를 판단하는 것을 권장하지 않는다. [카카오 공식 지침](https://developers.kakao.com/docs/en/kakaologin/common#user-info), [응답 필드](https://developers.kakao.com/docs/ko/kakaologin/rest-api#req-user-info).
- **수정:** 두 상태가 true인 경우만 검증된 이메일로 취급한다. 기존 계정 연결은 해당 계정 재인증이나 명시적 연결 절차로 처리하는 편이 안전하다. 이미 연결된 다른 카카오 ID의 덮어쓰기도 차단한다.

**A06 · P1 · 취향 사진 크기 제한이 메모리 수신 뒤 적용됨**

- 위치: [업로드 인터셉터](../../apps/api/src/preference-analyzer/preference-analyzer.controller.ts#L74), [크기 검사](../../apps/api/src/common/image-upload.ts#L64).
- `FilesInterceptor`에 `limits.fileSize`가 없다. 기본 메모리 저장 후 `ParseFilePipe`에서 10MB 제한을 검사하므로, 요청 한 건의 메모리 사용량이 파일 제한으로 제어되지 않는다. 프로필 업로드에는 이미 5MB 스트리밍 제한이 있어 취향 경로만 빠졌다.
- **재현:** 실제 Nest 컨트롤러와 multipart 요청으로 11MiB 파일을 전송했다. HTTP 400이었지만 검사 함수가 호출될 때 이미 11,534,336바이트가 메모리에 올라와 있었다.
- **수정:** Multer 단계에서 파일당 크기·파일 수·field/part 수를 제한하고, 프록시 총 요청 크기도 맞춘다. 대용량 업로드가 필요하면 직접 업로드와 서버 확인 절차를 사용한다.

**A07 · P1 · 전체 일정 교체 실패 시 기존 일정 유실**

- 위치: [삭제→저장](../../apps/api/src/itinerary/itinerary.service.ts#L25), [전체 재계획 호출](../../apps/api/src/planner/planner.service.ts#L437).
- 전체 교체는 기존 행 삭제와 신규 행 저장이 별도 작업이다. 부분 교체의 `replaceDayItems`에는 트랜잭션이 있지만 전체 교체에는 없다.
- **재현:** 감사용 PostgreSQL에서 기존 일정 1개를 만든 뒤 신규 저장에 NOT NULL 오류를 주입했다. 전체 교체는 실패 후 **0개**, 부분 교체는 실패 후 **1개**가 남았다.
- **영향:** DB 오류·프로세스 종료 등이 삭제와 저장 사이에 발생하면 기존 일정과 메모가 사라진다. 큐 재시도에서도 복구할 원본이 없다.
- **수정:** 전체 교체도 하나의 DB 트랜잭션으로 묶는다. 별도로 재계획 중 수동 수정 덮어쓰기를 막을 여행 버전 검증을 추가하는 것이 좋다.

**A08 · P1 · 배포 Node 20과 Firebase Admin 14 요구 버전 불일치**

- 위치: [.nvmrc](../../.nvmrc), [Docker](../../apps/api/Dockerfile#L14), [Firebase 의존성](../../apps/api/package.json), [CI](../../.github/workflows/ci.yml).
- Docker와 CI는 Node 20을 사용한다. 설치된 `firebase-admin@14.0.0`은 `engines.node >=22`를 요구한다. 로컬 Node 26에서의 빌드 성공으로 이 차이가 가려진다. [Firebase 공식 manifest](https://github.com/firebase/firebase-admin-node/blob/v14.0.0/package.json).
- Node 20은 2026-04-30 지원 종료 일정이며 현재 EOL이다. [Node 공식 지원 일정](https://github.com/nodejs/Release#release-schedule).
- **수정:** Docker·`.nvmrc`·CI·로컬 기준을 지원 중인 Node 24 LTS 등으로 통일하고 실제 컨테이너 빌드/기동을 확인한다. 현재 Node 20 컨테이너에서 크래시를 재현한 것은 아니며, 지원 범위 불일치와 EOL을 확인한 것이다.

**기능·성능 문제**

**A09 · P2 · 일부 멤버 권한 회수 경로에서 WebSocket 구독 유지**

- 위치: [상태 변경](../../apps/api/src/trip-members/trip-members.service.ts#L246), [초대 거절](../../apps/api/src/trip-members/trip-members.service.ts#L230), [정상 제거 경로의 강제 퇴장](../../apps/api/src/trip-members/trip-members.service.ts#L294).
- `update(status: 'pending')`와 accepted 멤버에게도 열려 있는 `rejectInvite`는 멤버 권한을 없애면서 `evictFromTrip`을 호출하지 않는다. `remove`만 호출한다.
- **재현:** accepted→pending 변경 후 HTTP 권한은 false였지만 소켓 퇴장 호출은 0회였다. 이미 가입한 room은 서버 퇴장 없이 유지된다.
- 반대 방향인 pending→accepted도 소유자가 PATCH로 바꿀 수 있어 당사자 초대 수락을 우회한다.
- **수정:** 회원 멤버의 초대 상태 전이를 전용 메서드로 제한하고, 모든 권한 회수 경로에서 구독을 해제한다. 장시간 연결의 토큰 만료도 함께 검사한다.

**A10 · P2 · refresh token 부재 이후 같은 탭에서 갱신이 계속 막힘**

- 위치: [tryRefresh](../../apps/web/src/shared/api/client.ts#L108).
- `refreshInFlight`에 Promise를 넣은 뒤, refresh token이 없으면 `try/finally` 진입 전에 반환한다. null로 정리되지 않은 Promise가 남아 이후 호출도 계속 null을 받는다.
- **재현:** 토큰 없는 상태로 한 번 실행한 후 토큰을 추가해 재실행했다. 결과는 null, refresh HTTP 호출은 0회였다.
- **수정:** 토큰 조회와 조기 반환까지 전체를 finally 범위에 넣고 동일 Promise만 정리한다. 임시 네트워크/브리지 오류를 즉시 영구 로그아웃으로 처리하는 정책도 재검토한다.

**A11 · P2 · 수동 일정 입력·순서 변경 검증 누락**

- 위치: [DTO](../../apps/api/src/main-planner/dto/main-planner.dto.ts#L183), [추가](../../apps/api/src/main-planner/main-planner.service.ts#L431), [순서](../../apps/api/src/main-planner/main-planner.service.ts#L540), [시각 변환](../../apps/api/src/main-planner/main-planner.service.ts#L621).
- 순서는 길이와 각 ID의 존재만 확인한다. `[A, A]`도 두 항목 목록으로 통과한다. **DB 재현 결과 두 항목의 order가 `[2, 2]`가 됐다.**
- 일차는 1 이상만 확인한다. **1일 여행에 day=2가 저장됐다.** 화면에서 일차 탭을 여행 기간으로 만들기 때문에 항목이 숨겨질 수 있다.
- 시간은 숫자 두 자리 형식만 검사한다. **`99:99`가 DTO를 통과하고 Invalid Date를 만들었다.** DB 저장 오류로 이어지는 경로다.
- **수정:** `ArrayUnique` 및 정확한 집합 비교, 여행 기간에 대한 일차 상한, 기존 공통 `HH_MM` 범위 검증을 적용한다. 추가·수정·제안 승인 경로에 동일 규칙을 적용한다.

**A12 · P2 · 임베딩 장애 시 임시 hash 벡터가 영구 개인화 데이터로 저장됨**

- 위치: [폴백](../../apps/api/src/embedding/text-embedding.service.ts#L32), [취향 저장](../../apps/api/src/preferences/preferences.service.ts#L142), [벡터 덮어쓰기](../../apps/api/src/preferences/preference-embedding.repository.ts#L15), [검색 사용](../../apps/api/src/planner/retrieval/place-retrieval.service.ts#L87).
- `embed()`는 원격 실패 시 hash 벡터를 반환하면서 출처를 지운다. 취향 저장은 이를 정상 벡터처럼 기존 벡터에 덮어쓴다. 모델이 복구돼도 다음 취향 저장/재임베딩까지 서로 다른 공간의 벡터가 섞인다. 원격 벡터 차원도 잘라내기/0 패딩으로 맞추므로 모델 설정 오류를 숨길 수 있다.
- **재현:** 원격 응답 실패를 대체한 상태에서 실제 임베딩·취향 서비스가 1,024차원의 hash 폴백을 저장 함수에 전달했다.
- **수정:** `embedWithSource` 결과를 검사해 영구 저장에는 정상 원격 벡터만 허용한다. 장애 시 마지막 정상 벡터를 유지하거나 개인화를 일시 생략하고 재처리 큐를 둔다. 모델·차원·버전을 저장해 검색 시 호환성을 확인한다.

**A13 · P2 · 여행 목록 N+1과 주요 조회 인덱스 부재**

- 위치: [목록](../../apps/api/src/main-planner/main-planner.service.ts#L101), [여행별 요약](../../apps/api/src/main-planner/main-planner.service.ts#L762), [멤버 조회](../../apps/api/src/trip-members/trip-members.service.ts#L125), [owner 보정](../../apps/api/src/trip-members/trip-members.service.ts#L356).
- **실측:** 감사용 DB에 여행 10개와 owner 행을 준비한 뒤 목록을 조회했다. 반복 조회 상태에서도 **SELECT 82회**였다. 외부 API는 사용하지 않았다.
- 여행마다 멤버 조회·owner 보정·취향 조회·항목 수·대표 항목 조회가 반복된다. 페이지네이션 없이 모두 `Promise.all`로 실행한다. owner 보정의 `save`도 추가 SELECT를 유발한다. 이번 정상 상태 측정에서는 UPDATE는 발생하지 않았다.
- 마이그레이션 적용 DB의 `trips`는 PK·shareToken, `trip_members`와 `itinerary_items`는 PK 인덱스만 있었다.
- **수정:** 여행 목록은 페이지네이션하고 멤버·항목 집계를 배치 조회한다. owner 생성/수정은 여행 생성·프로필 변경 시 처리한다. 실제 계획을 확인하며 `trips(userId, createdAt)`, `trip_members(userId, status, tripId)`/`(tripId)`, `itinerary_items(tripId, day, order)` 인덱스를 검토한다.

**A14 · P2 · 의존성 보안 공지 19건 잔존**

전체 audit와 `--prod`를 모두 실행했다. 공지 수가 공격 가능한 서비스 취약점 수와 같지는 않다. 아래 버전은 audit가 제시한 해당 계열의 최소 수정 버전이며, 업그레이드 후 호환성 검사가 필요하다.

| 패키지 | 설치 버전 | 검토할 수정 버전 | 해석 |
| --- | --- | --- | --- |
| qs | 6.15.3 | 6.16.0 이상 | API Express/body-parser 의존성. 공지는 특정 comma 파싱 또는 parse→stringify 조건에 의존하며 이 앱에서 악용 성공은 확인하지 않음 |
| image-size | 1.2.1 | 공지상 수정 버전 없음 | React Native Metro 경로. 악성 이미지 빌드 입력의 무한 루프. API 사진 처리에서 직접 사용하지 않음 |
| browserslist | 4.28.2 | 4.28.7 이상 | 빌드/codegen 입력 경로. prod audit에 포함되어도 모바일 기기 런타임 노출을 뜻하지 않음 |
| postcss | 8.5.13 | 8.5.23 이상 | 악성 CSS/source map의 파일 접근 |
| nanoid | 3.3.12 | 3.3.18 이상 | 비정상 크기의 generator 호출 조건 |
| brace-expansion | 1.1.14 | 1.1.18 이상 | glob 확장 DoS. 기존 override는 이 1.x 계열을 빠뜨림 |
| js-yaml | 3.14.2 | 3.15.1 이상 | YAML 처리 DoS. 기존 override는 4.x만 지정 |
| @babel/plugin-transform-modules-systemjs | 7.29.0 | 7.29.4 이상 | 악성 컴파일 입력 |
| turbo | 2.9.9 | 2.9.14 이상 | 로컬 실행·로그인 콜백 관련 공지 |

근거: [qs isBuffer 공지](https://github.com/advisories/GHSA-4mjr-xmp4-gh2g), [qs comma 공지](https://github.com/advisories/GHSA-x5fp-wj9c-mxmx), [image-size 공지](https://github.com/advisories/GHSA-w3rx-r6r6-pgpr). 모든 공지 URL·설치 경로는 동반 evidence JSON에 기록했다. 무조건 최신 메이저로 override하는 방법은 피하고, 상위 의존성 갱신 또는 호환되는 패치를 선택한다.

**추가 개선·운영 확인 사항**

- [LLM 기동 스크립트](../../infra/runpod/start.sh#L23)는 `LLAMA_API_KEY`가 없어도 두 서버를 `0.0.0.0`에서 연다. 공개 RunPod 프록시를 쓰면서 키를 누락하면 GPU를 무인증으로 사용할 수 있는 설정이다. 공개 배포 시 키를 필수화하고 외부 접근을 제한한다. 실제 운영 키 설정은 확인하지 않았다.
- [재계획](../../apps/api/src/replanning/replanning.service.ts#L97)·[사진 분석](../../apps/api/src/preference-analyzer/preference-analysis.service.ts#L101)의 중복 확인은 전역 큐의 모든 진행 잡을 읽는다. 규모가 늘면 사용자/여행별 job ID 인덱스와 원자적 중복 방지로 바꾼다. 서로 다른 scope의 동시 요청이 조회→등록 사이를 통과할 가능성도 남는다.
- [사진 업로드](../../apps/api/src/preference-analyzer/preference-analyzer.controller.ts#L100)는 목록 읽기→객체 업로드→목록 덮어쓰기다. 여러 탭의 동시 업로드에서 갱신 유실·고아 객체가 생길 수 있다. DB 잠금/버전과 실패 보상 처리를 검토한다. 동시성 실측은 하지 않았다.
- [웹 세션](../../apps/web/src/shared/lib/session-token.ts#L45)은 일반 브라우저에서 access·refresh를 localStorage에 저장한다. 현재 직접 XSS는 재현하지 않았다. 다만 XSS 발생 시 장기 토큰까지 유출될 수 있으므로 refresh를 HttpOnly 쿠키로 옮기는 설계를 검토한다. 현재 CSP의 `frame-ancestors`는 스크립트 실행 제한을 제공하지 않는다.
- 웹 refresh는 탭별 singleton이다. 여러 탭이 같은 refresh token을 동시에 회전하면 한 탭의 401 처리로 공유 세션이 지워질 수 있다. Web Locks/BroadcastChannel 등으로 계정 단위 갱신을 조율하고, 계정 변경 시 전역 QueryClient 캐시도 일관되게 초기화한다.
- 로그인 화면만으로 끝내지 말고 실제 JWT/인가를 통과하는 보안 E2E를 추가한다. 현재 HTTP E2E는 주로 인증 가드를 대체하며, 웹·모바일에는 package 수준의 `test` 스크립트가 없다. A01~A07·A09~A11은 기존 1,078개 테스트가 잡지 못했다.
- [라이브니스](../../apps/api/src/health/health.controller.ts#L15)는 의도대로 프로세스 생존만 확인한다. 이를 유지하면서 DB·Redis·LLM 준비 상태를 별도 지표/ready 경로로 제공하면 의존성 장애를 감지하기 쉽다.
- 임시 DB의 엔티티 diff는 `notificationPreferences` 기본값 변경 1건이었다. 서비스에서 기본값을 병합하므로 즉시 장애로 분류하지 않았다. 차기 마이그레이션으로 정합성을 맞춘다.
- 웹 경로별 정적 entry chunk 합산은 `/` gzip 51.8KiB, `/planner` 120.1KiB, `/trips/new` 81.0KiB였다. 이는 프로젝트 번들 보고 도구의 범위이며, 공통 런타임·동적 청크·지도 SDK·이미지를 포함한 실제 전체 전송량이나 LCP는 아니다. 번들보다 A13의 서버 왕복 축소가 먼저다.
- 린트 경고 263개는 별도 정리 대상이다. 대부분 API 테스트의 `any`다. [main-planner 서비스](../../apps/api/src/main-planner/main-planner.service.ts)는 1,500줄 이상이므로 공유·멤버·일정 편집·장소 해석 책임을 나누면 인가 규칙 누락을 줄일 수 있다.
- 기존 백로그에는 완료된 모바일 서명/도메인 항목도 미완료로 남아 있다. 이번에는 실제 `build.gradle`의 release 서명 분리와 `com.tripick.place` 값을 확인했으므로 과거 문구를 보안 결함으로 재보고하지 않았다.

**확인된 기존 방어와 검사 한계**

JWT 알고리즘 고정, production 예시 시크릿 거부, OAuth state·bind·일회용 코드, 이메일 토큰 단일 소비, 공개/비공개 버킷 분리, 프로필 업로드 크기 제한, 기본 HTTP rate limit, 지도 문자열 HTML escape, 주요 SQL 값 바인딩은 구현되어 있다. 이번 검토에서 직접 SQL injection·지도 XSS·알고리즘 혼동 우회는 확인하지 못했다.

운영 환경 변수·IAM·R2 실제 정책·방화벽·백업 복구·TLS 종단·도메인 메일 설정은 확인하지 않았다. 실제 LLM/Kakao/FCM 호출, 네이티브 release 빌드와 실기기 위치/APNs 검증도 수행하지 않았다. Browser 런타임의 사용 가능한 브라우저 목록이 비어 있어 시각적 UI·키보드·접근성·브라우저 성능 검증은 미실행이다. HTTP 200 확인을 화면 동작 검증으로 간주하지 않았다.

수정 순서는 사진 소유권·SSRF·재계획 인가 → 세션/카카오 검증 → 업로드 메모리·전체 교체 트랜잭션·Node 기준 → 나머지 기능/성능/의존성이다. [재현·검사 증거 JSON](project-audit-2026-09-07-evidence.json)을 함께 남겼다.
