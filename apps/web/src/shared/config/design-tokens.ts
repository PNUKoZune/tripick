/**
 * docs/design-system/toss-v1.md 의 토큰을 코드로 옮긴 값.
 * Tailwind v4 + CSS variables 를 같이 쓰기 때문에 별도 export 만 둔다.
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

export const radius = {
  base: 20,
  sub: 16,
  chip: 14,
  button: 18,
  input: 16,
} as const;
