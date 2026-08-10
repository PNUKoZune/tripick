/// <reference types="jest" />

import { OPENING_HOURS_FIELD, isClosedAt, parseOpeningHours } from '../../../src/planner/retrieval/opening-hours.parser';

describe('parseOpeningHours', () => {
  // 아래 입력은 KorService2 detailIntro2 실제 응답에서 그대로 가져온 값이다.
  describe('실제 detailIntro2 응답', () => {
    it('단순 범위를 읽는다 (쇼핑 opentime)', () => {
      expect(parseOpeningHours('09:00~22:00')).toBe('09:00-22:00');
      expect(parseOpeningHours('10:30-20:00')).toBe('10:30-20:00');
    });

    it('요일 접두어를 무시한다 (문화시설 usetimeculture)', () => {
      expect(parseOpeningHours('화요일~일요일 10:00~19:00')).toBe('10:00-19:00');
    });

    it('꼬리 안내문을 무시한다 (레포츠 usetimeleports)', () => {
      expect(parseOpeningHours('09:00~17:00※ 자세한 사항은 전화문의 요망')).toBe('09:00-17:00');
    });

    it('준비시간이 붙어도 개방 범위를 유지한다 (관광지 usetime)', () => {
      expect(parseOpeningHours('- 09:00~18:00- 준비시간 12:00~13:00')).toBe('09:00-18:00');
    });

    it('브레이크타임·라스트오더를 개방 범위 안으로 흡수한다 (음식점 opentimefood)', () => {
      expect(parseOpeningHours('10:00~22:00 (15:30~16:30 브레이크타임)')).toBe('10:00-22:00');
      expect(parseOpeningHours('10:00~20:30 (라스트오더 20:00)')).toBe('10:00-20:30');
    });

    it('HTML 조각이 섞인 계절별 운영을 가장 넓은 범위로 합친다', () => {
      const raw =
        '[관람시간]<br>\n- 3월~11월 10:00~18:00<br>\n- 12월~2월 10:00~17:00<br>\n' +
        '※ 관람 시 종료 40분 전까지 입장<br>\n[체험시간]<br>\n- 10:00~16:00';
      expect(parseOpeningHours(raw)).toBe('10:00-18:00');
    });

    it('HTML 개행으로 나뉜 음식점 준비시간을 흡수한다', () => {
      expect(parseOpeningHours('- 11:20~21:30<br>- 준비시간 15:00~17:00')).toBe('11:20-21:30');
    });

    it('상시 개방을 하루 전체로 본다', () => {
      expect(parseOpeningHours('상시 개방')).toBe('00:00-23:59');
    });

    it('"연중무휴"는 24시간 영업이 아니므로 비운다 (휴무일 없음일 뿐)', () => {
      // 시간 정보가 아닌데 00:00-23:59 로 오해석하면 밤 방문도 통과시켜 버린다.
      expect(parseOpeningHours('연중무휴')).toBeUndefined();
    });

    it('"연중무휴 11:00~22:00"은 실제 범위를 쓴다', () => {
      expect(parseOpeningHours('연중무휴 11:00~22:00')).toBe('11:00-22:00');
    });

    it('범위 없이 나열된 시각만 있으면 비운다 (미사 시간표)', () => {
      const raw =
        '- 주일미사 07:00(오전미사) / 10:00(교중미사) / 18:00(학생미사)' +
        '- 토요일 미사 18:00 / 07:00(매월 첫 토요일 성모신심미사)' +
        '- 평일미사 월 07:00 / 화 19:00 / 수 10:00 / 목 19:00 / 금 10:00※ 자세한 사항은 홈페이지 참조';
      expect(parseOpeningHours(raw)).toBeUndefined();
    });
  });

  describe('경계', () => {
    it('빈 값·공백·읽을 수 없는 문구는 비운다', () => {
      expect(parseOpeningHours(undefined)).toBeUndefined();
      expect(parseOpeningHours(null)).toBeUndefined();
      expect(parseOpeningHours('')).toBeUndefined();
      expect(parseOpeningHours('   ')).toBeUndefined();
      expect(parseOpeningHours('홈페이지 참조')).toBeUndefined();
    });

    it('자정을 넘기는 영업은 그날 끝까지로 자른다', () => {
      // 소비측 'HH:MM-HH:MM' 는 자정 넘김을 표현하지 못한다.
      expect(parseOpeningHours('18:00~02:00')).toBe('18:00-23:59');
    });

    it('24:00 종료를 23:59 로 접는다', () => {
      expect(parseOpeningHours('09:00~24:00')).toBe('09:00-23:59');
    });

    it('한 자리 시각을 0으로 채운다', () => {
      expect(parseOpeningHours('9:00~18:00')).toBe('09:00-18:00');
    });

    it('시 단위 표기를 폴백으로 읽는다', () => {
      expect(parseOpeningHours('9시~18시')).toBe('09:00-18:00');
    });

    it('실제 범위가 있으면 "24시간 전 예약" 문구에 속지 않는다', () => {
      expect(parseOpeningHours('09:00~18:00 (24시간 전 예약 필수)')).toBe('09:00-18:00');
    });

    it('시각이 아닌 숫자쌍은 버린다', () => {
      expect(parseOpeningHours('25:00~99:99')).toBeUndefined();
    });

    it('소비측 정규식이 받는 형식으로만 내보낸다', () => {
      // ConstraintEngine·CragEvaluator·PlannerService 가 공유하는 형식.
      const consumerPattern = /^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/;
      const inputs = ['09:00~22:00', '상시 개방', '9시~18시', '18:00~02:00', '- 09:00~18:00- 준비시간 12:00~13:00'];
      for (const input of inputs) {
        expect(parseOpeningHours(input)).toMatch(consumerPattern);
      }
    });
  });

  describe('OPENING_HOURS_FIELD', () => {
    it('타입마다 다른 필드명을 매핑한다', () => {
      expect(OPENING_HOURS_FIELD['12']).toBe('usetime');
      expect(OPENING_HOURS_FIELD['14']).toBe('usetimeculture');
      expect(OPENING_HOURS_FIELD['15']).toBe('playtime');
      expect(OPENING_HOURS_FIELD['28']).toBe('usetimeleports');
      expect(OPENING_HOURS_FIELD['38']).toBe('opentime');
      expect(OPENING_HOURS_FIELD['39']).toBe('opentimefood');
    });

    it('여행코스(25)는 매핑하지 않는다 (taketime 은 소요시간)', () => {
      expect(OPENING_HOURS_FIELD['25']).toBeUndefined();
    });
  });
});

describe('isClosedAt', () => {
  /** 2026-08-01 KST 기준 시각 (UTC = KST-9) */
  const at = (kstHour: number, kstMinute = 0): Date =>
    new Date(Date.UTC(2026, 7, 1, (kstHour - 9 + 24) % 24, kstMinute));

  it('영업시간 밖이면 true', () => {
    expect(isClosedAt('07:00-18:00', at(21))).toBe(true);
    expect(isClosedAt('09:00-18:00', at(6))).toBe(true);
  });

  it('영업시간 안(경계 포함)이면 false', () => {
    expect(isClosedAt('07:00-18:00', at(12))).toBe(false);
    expect(isClosedAt('07:00-18:00', at(7))).toBe(false);
    expect(isClosedAt('07:00-18:00', at(18))).toBe(false);
  });

  it('판정 불가는 닫힘이 아니다 — 데이터 없음을 닫힘으로 읽으면 카카오 전용 후보 전체가 닫힘이 된다', () => {
    expect(isClosedAt(undefined, at(21))).toBe(false);
    expect(isClosedAt(null, at(21))).toBe(false);
    expect(isClosedAt('', at(21))).toBe(false);
    expect(isClosedAt('매일 07:00~18:00', at(21))).toBe(false); // 정본 형식 아님
  });

  it('상시 개방(00:00-23:59)은 어느 시각도 닫힘이 아니다', () => {
    expect(isClosedAt('00:00-23:59', at(3))).toBe(false);
    expect(isClosedAt('00:00-23:59', at(23, 58))).toBe(false);
  });
});
