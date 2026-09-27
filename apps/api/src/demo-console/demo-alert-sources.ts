import { Injectable } from '@nestjs/common';
import type { ParsedForecast } from '@tripick/utils';
import type {
  ConcentrationLookup,
  ConcentrationSeries,
} from '../planner/retrieval/tats-cnctr-rate.service';
import {
  DEMO_CROWD_BASELINE_RATE,
  DEMO_CROWD_PEAK_RATE,
  DEMO_CROWD_SERIES_DAYS,
  DEMO_RAIN_HOURS,
  DEMO_RAIN_PROBABILITY,
  DEMO_RAIN_TYPE,
} from './demo-console.constants';

/**
 * 시연 콘솔이 알림 스캐너에 물려 주는 **외부 데이터 대역**.
 *
 * 스캐너(WeatherAlertService·CrowdAlertService)는 운영과 똑같은 인스턴스 로직을 쓰고,
 * 바깥에서 오는 값(기상청 예보·KTO 집중률)만 여기서 만들어 넣는다. 발표장에서 비가 오거나
 * 관광지가 붐빌 때까지 기다릴 수 없기 때문이며, 임계 판정·수신자 결정·중복 억제·인박스
 * 저장·FCM 발송은 전부 실제 경로가 그대로 처리한다.
 *
 * 대상 일자는 시나리오 실행 직전에 주입한다 — 상시 "항상 비" 를 반환하면 같은 여행의
 * 다른 날까지 알림이 나가 시연이 지저분해진다.
 */
@Injectable()
export class DemoForecastSource {
  /** 비 예보를 낼 일자(YYYYMMDD) 집합. 실행 직전에 교체한다. */
  private rainyDates = new Set<string>();

  setRainyDates(dates: string[]): void {
    this.rainyDates = new Set(dates);
  }

  /** WeatherHelper 와 같은 시그니처 — 좌표는 쓰지 않고 주입된 일자에만 강수 슬롯을 만든다. */
  async getExtendedForecast(_lat: number, _lng: number): Promise<Map<string, ParsedForecast>> {
    const forecasts = new Map<string, ParsedForecast>();
    for (const date of this.rainyDates) {
      for (const time of DEMO_RAIN_HOURS) {
        forecasts.set(`${date}_${time}`, {
          date,
          time,
          precipitationProbability: DEMO_RAIN_PROBABILITY,
          precipitationType: DEMO_RAIN_TYPE,
          skyCondition: 4,
        });
      }
    }
    return forecasts;
  }
}

/**
 * 집중률(KTO) 대역. 대상 일자만 평소치보다 크게 올려, 상대 임계(장소 평균 × 배수)와
 * 절대 하한을 함께 넘기게 만든다. 평균은 만들어 낸 시계열에서 그대로 계산한다.
 */
@Injectable()
export class DemoConcentrationSource {
  private crowdedDates = new Set<string>();
  /** 시계열 시작일(YYYYMMDD) — 평균 산출 구간의 기준 */
  private seriesStart = '';

  setCrowdedDates(dates: string[], seriesStart: string): void {
    this.crowdedDates = new Set(dates);
    this.seriesStart = seriesStart;
  }

  /** 주소 해석은 시연에서 변수로 두지 않는다 — 코드는 판정에 쓰이지 않고 조회 인자로만 간다. */
  async resolveRegionCode(_address: string): Promise<{ areaCd: string; signguCd: string } | null> {
    return { areaCd: '11', signguCd: '11200' };
  }

  async fetchConcentration(
    _areaCd: string,
    _signguCd: string,
    tAtsNm: string,
  ): Promise<ConcentrationLookup> {
    const ratesByYmd = new Map<string, number>();
    for (let offset = 0; offset < DEMO_CROWD_SERIES_DAYS; offset += 1) {
      const ymd = addDaysYmd(this.seriesStart, offset);
      ratesByYmd.set(
        ymd,
        this.crowdedDates.has(ymd) ? DEMO_CROWD_PEAK_RATE : DEMO_CROWD_BASELINE_RATE,
      );
    }
    // 주입한 일자가 시계열 구간 밖이면(먼 미래 여행) 그 날짜도 채워 넣는다.
    for (const ymd of this.crowdedDates) {
      if (!ratesByYmd.has(ymd)) ratesByYmd.set(ymd, DEMO_CROWD_PEAK_RATE);
    }

    const rates = [...ratesByYmd.values()];
    const mean = rates.reduce((sum, rate) => sum + rate, 0) / rates.length;
    const series: ConcentrationSeries = { tAtsNm, ratesByYmd, mean };
    return { ok: true, series };
  }
}

/** YYYYMMDD 에 일수를 더한다. UTC 산술이라 서버 TZ 에 영향받지 않는다. */
function addDaysYmd(ymd: string, days: number): string {
  const year = Number(ymd.slice(0, 4));
  const month = Number(ymd.slice(4, 6));
  const day = Number(ymd.slice(6, 8));
  const utc = new Date(Date.UTC(year, month - 1, day));
  utc.setUTCDate(utc.getUTCDate() + days);
  return utc.toISOString().slice(0, 10).replace(/-/g, '');
}
