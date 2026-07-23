# 디자인 결정 — SPEC-WEB-VISUAL-REDESIGN-001

본 SPEC 의 핵심 산출물은 근본적으로 디자인 시스템 변경이므로, 토큰·팔레트 결정을 여기 고정한다.
모든 hex 값의 정본은 랜딩 목업의 CSS 커스텀 프로퍼티 블록이며(나머지 4개 목업이 verbatim 재사용),
아래 표는 그 값을 코드 반영용으로 옮긴 것이다.

## 1. 확장 팔레트 (라이트)

| 토큰 | 값 | 역할 |
|------|----|------|
| `--bg` | #F5F7FB | 페이지 배경 |
| `--card` / `--card-soft` | #FFFFFF / #F8FAFD | 카드 / 서브 카드 |
| `--ink` / `--ink-sub` / `--ink-faint` | #182136 / #55617A / #8A94AB | 텍스트 3단 |
| `--line` / `--line-dot` | #E4E9F2 / #CBD5E6 | 구분선 / 점선 |
| `--primary` / `--primary-deep` / `--primary-tint` | #2E6BE6 / #1F55C4 / #EAF1FE | 주 액션 |
| `--accent` / `--accent-deep` / `--accent-tint` | #FF9B70 / #DE6A3B / #FFEFE6 | sunset 포인트 |
| `--hl` | #FFDCC6 | 헤드라인 마커 하이라이트 |

## 2. "하루의 빛" — 4-stop 타임라인 색 (시그니처)

| 토큰 | 라이트 | 다크 | 시간대 |
|------|--------|------|--------|
| `--t-morning` | #8FBCFF | #8FBCFF | 아침 |
| `--t-noon` | #4F87EE | #5B8DEF | 낮 |
| `--t-gold` | #FFC46B | #FFC46B | 오후 |
| `--t-dusk` | #FF8A5C | #FF8A5C | 저녁 |

- **세로 rail 정지점**: `linear-gradient(180deg, morning 0%, noon 36%, gold 70%, dusk 100%)`.
- **가로 미니 레일**(결과 요약): 동일 정지점 90deg.
- **도트 색 매핑**(순수 함수): 항목 시각 → 시간대 → 위 4색 중 하나. 백엔드 호출 없음.

## 3. 광안리 장면 색 (랜딩 hero SVG 전용)

`--sky-top` #C9DFFC · `--sky-glow` #FFDFC8 · `--sun` #FF9B70 · `--sun-halo` rgba(255,155,112,.42) ·
`--sea-1/2/3` #A9CAF6/#7FA9EF/#4C7FDD · `--sil` #26406F · `--bridge` #24365E · `--lights` #FFB37F ·
`--star` transparent(라이트)/rgba(255,255,255,.55)(다크) · `--glass` rgba(255,255,255,.88).

## 4. 다크 (시스템 선호도)

전체 다크 값은 목업 다크 블록과 동일(`--bg` #0B111E, `--card` #131B2C, `--ink` #E9EEF9,
`--primary` #7CA5FC, `--line` #263149 등). **수동 토글 UI 없음, `data-theme` 훅 없음** —
`prefers-color-scheme: dark` 시스템 자동 감지만(사용자 확정, plan.md §B). 뷰어 토글·`data-theme` 는 별도 요청 시 추가.

## 5. toss-v1 규칙 완화 결정 (문서화 대상 = REQ-WVR-060)

| toss-v1 규칙 | 완화 내용 | 적용 위치 |
|--------------|-----------|-----------|
| §3 "그라데이션 금지" | 4-stop 타임라인 그라데이션 허용 | 결과 화면 타임라인·요약 레일 |
| §11 "hero 배경 이미지/일러스트 금지" | 인라인 SVG 일러스트 허용(사진 아님) | 랜딩 hero |

나머지 toss-v1 원칙(모바일 단일 컬럼, 화면당 primary 1개, 카드 리듬, 정보 위계)은 유지·진화.

## 6. 결정 근거 (trade-off)

- **왜 primary 를 #3182F6 → #2E6BE6 로**: 확장 팔레트 전체 톤과 조화(더 깊은 신뢰감).
  적용 범위는 **대상 5개 화면 로컬 스코프만**으로 확정 — `shared/ui` 전역 토큰 불변(사용자 확정, plan.md §B).
- **왜 색으로 시간을 인코딩**: 지도 없이 텍스트 타임라인이 주인공인 결과 화면에서,
  색이 하루의 흐름을 즉각 전달 — 랜딩 hero(노을)와 같은 시각 은유의 재사용.
- **왜 사진(래스터) 대신 인라인 SVG**: 번들 경량·다크 대응(토큰 참조)·확대 무손실.
