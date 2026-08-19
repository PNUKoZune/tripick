/**
 * docs/design-system/toss-v1.md 의 토큰을 코드로 옮긴 값.
 * Tailwind v4 + CSS variables 를 같이 쓰기 때문에 별도 export 만 둔다.
 *
 * @MX:ANCHOR: colors.primary(#3182F6) 는 shared/ui(버튼/칩/세그먼트) 전역에서 참조하는
 * 앱 전역 primary 값이다 — SPEC-WEB-VISUAL-REDESIGN-001 로 대상 5개 화면에 도입된
 * 새 파란색(#2E6BE6, 아래 wvrPaletteLight)과는 별개이며 이 값은 절대 변경하지 않는다.
 * @MX:REASON: 사용자 확정(plan.md §B) — primary 시프트는 대상 5개 화면 로컬 스코프만,
 * shared/ui 전역 토큰은 이번 스코프에서 불변.
 */
export const colors = {
  background: '#F7F8FA',
  surface: '#FFFFFF',
  surfaceMuted: '#FAFBFC',
  textPrimary: '#191F28',
  textSecondary: '#6B7684',
  textTertiary: '#8B95A1',
  primary: '#3182F6',
  primaryPressed: '#1B64DA',
  primarySoft: '#EAF2FF',
  success: '#00A86B',
  warning: '#FF8A00',
  warningSoft: '#FFF4E5',
  error: '#F04452',
  errorSoft: '#FFECEE',
  divider: '#E5E8EB',
  disabledSurface: '#F2F4F6',
  disabledText: '#B0B8C1',
} as const;

/**
 * 라운드 스케일 SSOT — 4단계 + `rounded-full`. 값이 10가지로 늘어나 있어서
 * 같은 역할의 요소가 화면마다 2~6px 씩 달랐다. 새 값을 늘리지 말고 역할로 고른다.
 *
 * - `micro`(8)   인라인 미세 요소 — 메모 pill, 툴팁, h-7~h-8 태그
 * - `control`(12) 컨트롤 — 버튼 · 인풋 · 칩 · 세그먼트 · 지도 위 컨트롤
 * - `card`(16)   카드 · 패널 · 드롭다운 · 선택 가능한 리스트 행
 * - `surface`(20) 큰 표면 — 모달 · 바텀시트 · mega-card · 랜딩 히어로
 */
export const radius = {
  micro: 8,
  control: 12,
  card: 16,
  surface: 20,
} as const;

/**
 * SPEC-WEB-VISUAL-REDESIGN-001 — "광안리의 하루" 확장 팔레트 (SSOT).
 *
 * `docs/design-system/mockups/tripick-landing-mockup.html` 의 CSS 커스텀 프로퍼티
 * 블록(정본)을 그대로 옮긴 값이다. 이 팔레트는 대상 5개 화면(랜딩 · 취향 입력 ·
 * 여행 조건 · 결과/플래너 · 재계획 시트)에 **로컬 스코프로만** 적용된다 —
 * `apps/web/src/app/globals.css` 의 `.wvr-scope` 클래스가 이 값과 동일한 CSS 변수를
 * 정의하며, 위 `colors`(전역 primary 등)와는 별개다.
 *
 * design.md §1~§4 참조.
 */
export const wvrPaletteLight = {
  bg: '#F5F7FB',
  card: '#FFFFFF',
  cardSoft: '#F8FAFD',
  ink: '#182136',
  inkSub: '#55617A',
  inkFaint: '#8A94AB',
  line: '#E4E9F2',
  lineDot: '#CBD5E6',

  primary: '#2E6BE6',
  primaryDeep: '#1F55C4',
  primaryTint: '#EAF1FE',
  btnBg: '#2E6BE6',
  btnBgPress: '#1F55C4',
  btnText: '#FFFFFF',
  ring: 'rgba(46,107,230,.28)',

  accent: '#FF9B70',
  accentDeep: '#DE6A3B',
  accentTint: '#FFEFE6',
  hl: '#FFDCC6',

  shadowCard: '0 8px 24px rgba(24,33,54,.05)',
  shadowBtn: '0 10px 22px rgba(46,107,230,.28)',
} as const;

export const wvrPaletteDark = {
  bg: '#0B111E',
  card: '#131B2C',
  cardSoft: '#172136',
  ink: '#E9EEF9',
  inkSub: '#A3AEC6',
  inkFaint: '#75809A',
  line: '#263149',
  lineDot: '#34405C',

  primary: '#7CA5FC',
  primaryDeep: '#9DBCFF',
  primaryTint: '#1B2A4A',
  btnBg: '#3B76F0',
  btnBgPress: '#2E63D6',
  btnText: '#FFFFFF',
  ring: 'rgba(124,165,252,.4)',

  accent: '#FF9B70',
  accentDeep: '#FFAD88',
  accentTint: '#33231C',
  hl: '#4A2F20',

  shadowCard: '0 8px 24px rgba(0,0,0,.3)',
  shadowBtn: '0 10px 22px rgba(20,50,120,.5)',
} as const;

/**
 * "하루의 빛" — 4-stop 타임라인 색 (시그니처 패턴).
 * 라이트/다크에서 --t-noon 만 값이 다르고 나머지 3개는 동일(design.md §2).
 */
export const wvrTimelineColors = {
  light: { morning: '#8FBCFF', noon: '#4F87EE', gold: '#FFC46B', dusk: '#FF8A5C' },
  dark: { morning: '#8FBCFF', noon: '#5B8DEF', gold: '#FFC46B', dusk: '#FF8A5C' },
} as const;

/** 광안리 장면 색 (랜딩 hero SVG 전용). design.md §3. */
export const wvrSceneColorsLight = {
  skyTop: '#C9DFFC',
  skyGlow: '#FFDFC8',
  sun: '#FF9B70',
  sunHalo: 'rgba(255,155,112,.42)',
  sea1: '#A9CAF6',
  sea2: '#7FA9EF',
  sea3: '#4C7FDD',
  sil: '#26406F',
  bridge: '#24365E',
  lights: '#FFB37F',
  star: 'transparent',
  glass: 'rgba(255,255,255,.88)',
} as const;

export const wvrSceneColorsDark = {
  skyTop: '#0B152C',
  skyGlow: '#543246',
  sun: '#FFA97E',
  sunHalo: 'rgba(255,169,126,.26)',
  sea1: '#223B69',
  sea2: '#1A2E54',
  sea3: '#12203D',
  sil: '#070D1C',
  bridge: '#0A1322',
  lights: '#FFC49A',
  star: 'rgba(255,255,255,.55)',
  glass: 'rgba(9,14,26,.74)',
} as const;

/**
 * 일정 항목 시각(HH:mm) → "하루의 빛" 시간대 색 매핑 (순수 함수, 백엔드 호출 없음).
 * REQ-WVR-042 — 타임라인 도트 색은 항목 시각의 시간대에서 결정된다.
 *
 * 경계: 06:00 이전/11:00 이전 = morning, 11:00~15:00 = noon,
 * 15:00~18:00 = gold, 18:00 이후 = dusk. (design.md 예시 목업의 10:00/12:30/15:00/19:00
 * 4-stop 배치와 동일한 구간 감각을 따른다.)
 */
export function timeSlotColorVar(scheduledAt: string): '--t-morning' | '--t-noon' | '--t-gold' | '--t-dusk' {
  const hour = Number.parseInt(scheduledAt.slice(0, 2), 10);
  if (Number.isNaN(hour) || hour < 11) return '--t-morning';
  if (hour < 15) return '--t-noon';
  if (hour < 18) return '--t-gold';
  return '--t-dusk';
}
