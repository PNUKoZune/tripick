# Toss-style design system v1 for TriPick

문서 목적: worker가 바로 구현 가능한 수준으로 모바일 우선 UI 규칙을 고정한다.

참조 패턴 요약:
- VRBO mobile home/search: 입력 요소를 한 카드 묶음으로 정리, primary CTA 명확화
- Navan trip detail: 결과를 카드/타임라인 섹션으로 분리, 정보 위계 선명화
- Atlys dates step: step/progress를 과하지 않게 노출
- Couple Joy / ParkMobile: 질문 → 선택지 → CTA 구조, disabled CTA 규칙 명확화

## 1. 기본 원칙

1. 모바일 우선 단일 컬럼
2. 한 화면 한 개의 primary CTA
3. 입력/결과/재계획을 각기 독립 섹션으로 분리
4. 시각적 화려함보다 읽기 속도와 다음 행동 명확성을 우선
5. 카드 반경, 간격, 섹션 리듬을 전 화면에서 통일

## 2. 레이아웃 규칙

### Viewport / container

- 기준 폭: `360px ~ 430px`
- 기본 page padding: 좌우 `20px`, 상단 `24px`, 하단 `32px`
- desktop에서도 본문 최대 폭 `480px`
- 섹션 간 기본 간격: `24px`
- 같은 카드 내부 row 간격: `12px`
- 같은 질문 내 선택지 간격: `10px`

### Section rhythm

화면은 아래 순서 중 필요한 섹션만 사용한다.

1. top context
2. primary content card
3. support card / helper text
4. sticky or bottom CTA

규칙:
- 빈 배경 위에 섹션을 길게 나열하지 말고, 의미 단위마다 카드화
- 카드 안에 또 CTA 카드를 중첩하지 않는다
- CTA는 카드 내부에 넣더라도 화면 우선순위상 1개만 강조한다

## 3. 색상 규칙

### 역할 색상

- Background: `#F7F8FA`
- Surface / Card: `#FFFFFF`
- Primary text: `#191F28`
- Secondary text: `#6B7684`
- Tertiary text: `#8B95A1`
- Primary action: `#3182F6`
- Primary action pressed: `#1B64DA`
- Success: `#00A86B`
- Warning: `#FF8A00`
- Error: `#F04452`
- Divider / border: `#E5E8EB`
- Disabled surface: `#F2F4F6`
- Disabled text: `#B0B8C1`

규칙:
- 그라데이션 금지
- 장식용 포인트 색상 2개 이상 동시 사용 금지
- hero 배경 이미지/일러스트는 v1에서 쓰지 않는다

## 4. 타이포그래피

- Font stack: system-ui, Apple SD Gothic Neo, Pretendard, sans-serif

### Text scale

- Hero / 주요 숫자: `28/34`, `700`
- Screen title: `24/32`, `700`
- Section title: `20/28`, `700`
- Card title: `18/26`, `600`
- Body: `16/24`, `500`
- Secondary body: `15/22`, `500`
- Caption: `13/18`, `500`
- Micro label: `12/16`, `600`

규칙:
- 한 문단 3줄 초과 카피 지양
- 제목 아래 보조 문구는 최대 2줄
- 긴 문장은 강제 줄바꿈 디자인에 의존하지 않고 자연스럽게 흐르게 작성

## 5. 카드 규칙

### Base card

- 배경: white
- border: `1px solid #E5E8EB`
- radius: `20px`
- padding: `20px`
- shadow: 매우 약하게 1단만 사용 (`0 8px 24px rgba(0,0,0,0.04)` 이하)

### Sub card / result item

- radius: `16px`
- padding: `16px`
- 배경: `#FAFBFC`
- border 우선, shadow 최소화

규칙:
- 카드 내부에 카드가 또 들어갈 때는 depth를 1단만 낮춘다
- 한 화면에 서로 다른 radius를 3종 이상 쓰지 않는다

## 6. 입력 규칙

### 공통 input

- 높이: `56px`
- radius: `16px`
- padding x: `16px`
- border: `1px solid #D6DBE1`
- background: white
- placeholder color: `#8B95A1`

### Focus

- border: `#3182F6`
- outline/shadow: `0 0 0 4px rgba(49,130,246,0.12)`

### Error

- border: `#F04452`
- helper text: `13px`, error color

### Disabled

- bg: `#F2F4F6`
- text: `#B0B8C1`
- border: `transparent`

## 7. 선택지 규칙

### Chip / segmented options

- 최소 높이: `44px`
- radius: `14px`
- padding: `12px 14px`
- 기본: white + gray border
- 선택됨: `#EAF2FF` bg + `#3182F6` border + `#1B64DA` text

### 질문 블록

구조:
1. 질문 제목
2. 설명 한 줄(선택)
3. 선택지 그룹
4. 오류/가이드 문구(필요 시)

규칙:
- 질문 하나당 CTA를 넣지 않는다
- 질문 여러 개를 스크롤 한 화면에 쌓더라도 현재 단계가 무엇인지 제목으로 명확히 보여준다

## 8. 버튼 규칙

### Primary button

- 높이: `56px`
- radius: `18px`
- padding x: `20px`
- bg: `#3182F6`
- text: white, `16/24`, `600`
- full width 기본

### Secondary button

- 높이: `52px`
- radius: `18px`
- bg: white
- border: `1px solid #D6DBE1`
- text: primary text

### Tertiary / text button

- 높이: `auto`
- text only or icon+text
- 색상: `#4E5968`

### Disabled CTA

- bg: `#E5E8EB`
- text: `#B0B8C1`
- shadow 없음
- disabled 이유를 버튼 위/아래 helper text로 설명

규칙:
- 한 화면에서 강조 버튼은 1개만 primary
- 카드 안에 소형 CTA를 여러 개 두지 않는다
- sticky bottom CTA를 쓰면 화면 상단에 동일 역할 버튼을 반복하지 않는다

## 9. 상태 표현

### Loading

- skeleton 또는 `로딩 중` 보조문구 사용
- 전체 페이지 spinner 단독 노출 금지
- 생성/재계획 중에는 현재 단계 문구 제공
  - 예: `취향을 반영해 일정을 정리하고 있어요`

### Empty

- 빈 상태에는 다음 행동 CTA 포함
- 문장 2개 이내

### Error

- 오류 제목 1줄
- 원인 요약 1줄
- 재시도 CTA 1개
- 개발용 상세 로그는 사용자 화면에 직접 노출하지 않음

### Success

- toast 남용 금지
- 완료 상태는 카드 상단 요약 또는 CTA 변화로 표현

## 10. 화면별 패턴

### A. Landing / 첫 진입

구성:
1. 한 줄 가치 제안
2. 짧은 보조 설명
3. `데모로 시작` primary CTA
4. 선택적으로 `카카오 로그인은 준비 중` 보조 텍스트

규칙:
- hero 이미지 금지
- 첫 화면 문구 총합 90자 내외 권장

### B. 취향 입력

구성:
1. step indicator (`1/3`, `2/3` 수준)
2. 질문 카드
3. 선택지
4. 하단 CTA

규칙:
- progress bar는 얇게 `4px`
- 현재 step 외 나머지 정보를 과도하게 노출하지 않음
- CTA는 조건 충족 전 disabled

### C. 여행 조건 입력

구성:
1. 목적지 입력
2. 날짜 카드
3. 라이프스타일/이동수단 카드
4. `일정 만들기` CTA

규칙:
- 목적지/날짜/이동수단을 한 mega-card 안에 묶어 VRBO식 단순함 유지
- 세부 고급 옵션은 접지 않는다. v1에서는 아예 숨긴다

### D. 결과 화면

구성:
1. 상단 요약 카드 (여행명, 기간, 핵심 톤)
2. day section 반복
3. 일정 item card 반복
4. 하단 `재계획 요청` CTA

규칙:
- Navan식 정보 위계 적용
- day title -> 시간 -> 장소 -> 보조정보 순서 고정
- 지도보다 텍스트 타임라인 우선

### E. 재계획 화면/모달

구성:
1. 재계획 사유 선택
2. 필요 추가 입력(예: 웨이팅 시간)
3. CTA

규칙:
- 질문-선택지-CTA 3단 구조 유지
- 불필요한 설명문 제거
- 변경 결과는 기존 일정과 비교 가능한 섹션으로 표시

## 11. 피해야 할 패턴

- 강한 그라데이션, glassmorphism, 과한 그림자
- 의미 없는 hero visual
- 긴 카피를 강제 줄바꿈으로 쪼개는 레이아웃
- 카드 안에 CTA 여러 개 중첩
- 한 화면에서 서로 다른 정렬 규칙 혼합
- primary/secondary/tertiary 버튼을 모두 같은 시각 무게로 배치
- 진행 중 상태를 모호한 spinner만으로 처리

## 12. 구현 체크리스트

개발 전/후 확인:
- page max-width가 `480px` 이하인가
- primary CTA가 화면당 1개인가
- card radius가 `20px / 16px` 체계 안에 있는가
- input height가 `56px`로 통일됐는가
- disabled CTA에 이유가 보이는가
- 결과 화면이 카드/타임라인 위계로 읽히는가
- 장식보다 정보 전달이 먼저 보이는가

## 13. v1 디자인 결정 요약

1. Toss 톤은 "깔끔함 + 신뢰감 + 빠른 다음 행동"으로 가져간다.
2. 브랜드 표현은 컬러 한두 개와 카드 리듬으로 해결하고, 장식형 비주얼은 쓰지 않는다.
3. 랜딩/입력/결과/재계획 모두 모바일 단일 컬럼을 기준으로 통일한다.
4. 결과 화면의 핵심 단위는 지도보다 카드형 일정 item이다.
5. 모든 CTA 상태는 enabled/disabled/loading 이유가 명확해야 한다.
