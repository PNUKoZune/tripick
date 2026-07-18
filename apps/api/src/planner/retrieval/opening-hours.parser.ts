/**
 * 한국관광공사 detailIntro2 의 영업시간 텍스트를 파서.
 *
 * 영업시간 필드명은 **관광 타입(contentTypeId)마다 다르다**. 공통 필드가 없으므로
 * 타입별로 매핑해야 하고, 값은 자유 서술이라 정규화가 필요하다.
 * 소비측(ConstraintEngine·CragEvaluator·PlannerService)이 모두 'HH:MM-HH:MM'
 * 한 줄 형식만 이해하므로 그 형식으로 좁혀서 내보낸다.
 */

/**
 * contentTypeId → detailIntro2 영업시간 필드명.
 *
 * 주의할 점:
 * - 25(여행코스)는 의도적으로 없다. taketime 은 영업시간이 아니라 소요시간('5시간')이다.
 * - 32(숙박)는 적재 대상이 아니다(checkintime/checkouttime 만 있다).
 * - 15(축제공연행사)의 usetimefestival 은 이름과 달리 **요금**('무료')이다. 시간은 playtime.
 */
export const OPENING_HOURS_FIELD: Record<string, string> = {
  '12': 'usetime', // 관광지
  '14': 'usetimeculture', // 문화시설
  '15': 'playtime', // 축제공연행사
  '28': 'usetimeleports', // 레포츠
  '38': 'opentime', // 쇼핑
  '39': 'opentimefood', // 음식점
};

const ALWAYS_OPEN = '00:00-23:59';
const MAX_MINUTE = 23 * 60 + 59;

/** '상시 개방', '24시간' 등 범위 없이 연중 개방을 뜻하는 표현. */
const ALWAYS_OPEN_PATTERN = /상시|항시|24\s*시간|연중\s*무휴/;

/** 'HH:MM~HH:MM' (구분자는 ~ - – —). 계절별·브레이크타임 등으로 여러 번 나올 수 있다. */
const RANGE_PATTERN = /(\d{1,2}):(\d{2})\s*[~\-–—]\s*(\d{1,2}):(\d{2})/g;

/** '9시~18시' 형태. HH:MM 범위가 하나도 없을 때만 폴백으로 쓴다. */
const HOUR_ONLY_PATTERN = /(\d{1,2})\s*시\s*[~\-–—]\s*(\d{1,2})\s*시/g;

/** HTML 조각·엔티티·개행이 섞여 오므로(예: '10:00~18:00<br>\n- 12월~2월 …') 평문으로 펴준다. */
function toPlainText(raw: string): string {
  return raw
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 시:분을 분 단위로. 24:00 은 자정 끝으로 보고 23:59 로 접는다. 범위를 벗어나면 null. */
function toMinutes(hour: number, minute: number): number | null {
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  if (minute > 59 || hour > 24) return null;
  if (hour === 24) return minute === 0 ? MAX_MINUTE : null;
  return hour * 60 + minute;
}

function format(minutes: number): string {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function collectRanges(text: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];

  for (const match of text.matchAll(RANGE_PATTERN)) {
    const start = toMinutes(Number(match[1]), Number(match[2]));
    const end = toMinutes(Number(match[3]), Number(match[4]));
    if (start === null || end === null) continue;
    // 종료가 시작보다 이르면 자정을 넘긴 영업(예: 18:00~02:00). 소비측 형식이
    // 자정 넘김을 표현하지 못하므로 그날 끝까지로 자른다(23:59).
    ranges.push({ start, end: end <= start ? MAX_MINUTE : end });
  }
  if (ranges.length > 0) return ranges;

  for (const match of text.matchAll(HOUR_ONLY_PATTERN)) {
    const start = toMinutes(Number(match[1]), 0);
    const end = toMinutes(Number(match[2]), 0);
    if (start === null || end === null) continue;
    ranges.push({ start, end: end <= start ? MAX_MINUTE : end });
  }
  return ranges;
}

/**
 * detailIntro2 영업시간 텍스트를 'HH:MM-HH:MM' 로 정규화한다. 못 읽으면 undefined
 * (소비측이 값 없음을 '제약 없음'으로 처리하므로, 잘못 좁히는 것보다 비우는 게 안전하다).
 *
 * 여러 범위가 나오면 **가장 넓은 봉투**(최소 시작 ~ 최대 종료)로 합친다. 계절별 운영
 * ('3월~11월 10:00~18:00 / 12월~2월 10:00~17:00')과 브레이크타임('10:00~22:00
 * (15:30~16:30 브레이크타임)')이 같은 필드에 섞여 오는데, 봉투를 쓰면 두 경우 모두
 * 실제 개방 시간을 덮는다. 좁게 잡아 멀쩡한 장소를 탈락시키는 쪽이 더 나쁘다.
 */
export function parseOpeningHours(raw?: string | null): string | undefined {
  if (!raw) return undefined;
  const text = toPlainText(raw);
  if (!text) return undefined;

  const ranges = collectRanges(text);
  if (ranges.length === 0) {
    // 범위를 못 찾았을 때만 개방 표현을 본다. '24시간 전 예약' 같은 문구가 섞인
    // 실제 범위를 덮어쓰지 않도록 순서를 지킨다.
    return ALWAYS_OPEN_PATTERN.test(text) ? ALWAYS_OPEN : undefined;
  }

  const start = Math.min(...ranges.map((range) => range.start));
  const end = Math.max(...ranges.map((range) => range.end));
  if (end <= start) return undefined;
  return `${format(start)}-${format(end)}`;
}
