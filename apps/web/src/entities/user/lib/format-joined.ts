/** ISO datetime → `2026.06 가입` 형태로 포맷. 잘못된 값이면 `가입일 미상`. */
export function formatJoinedSince(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '가입일 미상';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}.${m} 가입`;
}
