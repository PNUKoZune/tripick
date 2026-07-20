import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { detectKtoQuota, KtoQuotaExceededError } from './tour-api.service';
import { parseSigungu, regionStem } from './place-seeds';

/** tatsCnctrRatedList 응답 아이템 (관광지 1곳의 하루치 집중률). */
interface TatsCnctrItem {
  /** 대상 일자 YYYYMMDD */
  baseYmd: string | number;
  areaCd: string | number;
  areaNm: string;
  signguCd: string | number;
  signguNm: string;
  /** 관광지명 */
  tAtsNm: string;
  /** 집중률(%) — 문자열로 옴 */
  cnctrRate: string | number;
}

interface TatsCnctrResponse {
  response?: {
    header?: { resultCode?: string; resultMsg?: string };
    body?: {
      totalCount?: number;
      items?: '' | { item?: TatsCnctrItem | TatsCnctrItem[] };
    };
  };
}

/** ldongCode2 응답 아이템 (지역코드 해석용). code=lDongRegnCd/lDongSignguCd */
interface LdongItem {
  code: string | number;
  name: string;
}

interface LdongResponse {
  response?: {
    body?: { items?: '' | { item?: LdongItem | LdongItem[] } };
  };
}

/** 관광지 1곳의 향후 집중률 시계열. */
export interface ConcentrationSeries {
  /** 매칭된 관광지명(KTO 정본) */
  tAtsNm: string;
  /** YYYYMMDD → 집중률(%) */
  ratesByYmd: Map<string, number>;
  /** 기간 평균 집중률(%) — 상대 임계 판정 기준 */
  mean: number;
}

function toArray<T>(item: T | T[] | undefined): T[] {
  if (!item) return [];
  return Array.isArray(item) ? item : [item];
}

/** 이름 대조용 정규화 — 공백 제거만(대소문자는 한글에 무의미). */
function normalizePlace(name: string): string {
  return name.replace(/\s+/g, '').trim();
}

/**
 * 한국관광공사 관광지 집중률(방문자 추이 예측) 서비스.
 *
 * 향후 ~30일간 관광지별 일자별 집중률(cnctrRate)을 조회한다. **관광지(tAtsNm)만** 데이터가
 * 있고, 데이터 없는 이름은 totalCount 0 으로 조용히 빈 응답이 온다.
 *
 * 지역 필터로 areaCd(법정동 시도 2자리)·signguCd(법정동 시군구 5자리)가 필수인데, 일정 항목엔
 * 코드가 없고 주소·이름만 있으므로 ldongCode2 로 이름→코드 색인을 만들어 해석한다
 * (여행지 피커를 ldongCode2 로 옮긴 것과 같은 코드 계열). 색인은 거의 안 변하므로 1회 캐시.
 *
 * 이 데이터는 일정 생성/재계획 점수에는 쓰지 않는다 — CrowdAlertService 가 "혼잡 예상" 추천
 * 알림에만 사용한다(날씨 알림과 동일하게 자동 재계획 없이 사용자에게 변경을 권할 뿐).
 */
@Injectable()
export class TatsCnctrRateService {
  private readonly logger = new Logger(TatsCnctrRateService.name);
  private readonly TATS_BASE = 'https://apis.data.go.kr/B551011/TatsCnctrRateService';
  private readonly LDONG_BASE = 'https://apis.data.go.kr/B551011/KorService2';

  /** 시도명(stem) → areaCd. 최초 조회 시 1회 구축. */
  private sidoIndex: Promise<Map<string, string>> | null = null;
  /** areaCd → (시군구명 → signguCd). 등장한 시도만 지연 구축. */
  private readonly sigunguIndexByArea = new Map<string, Promise<Map<string, string>>>();

  constructor(private readonly config: ConfigService) {}

  private apiKey(): string {
    return this.config.get<string>('KTO_API_KEY', '');
  }

  /**
   * 관광지 1곳의 향후 집중률 시계열을 조회한다. 존재하지 않으면 null.
   * tAtsNm 은 서버에서 부분일치(LIKE)로 걸리므로, 응답 중 이름이 정확히 일치하는 관광지만
   * 골라 다른 관광지의 값이 섞이지 않게 한다.
   */
  async fetchConcentration(
    areaCd: string,
    signguCd: string,
    tAtsNm: string,
  ): Promise<ConcentrationSeries | null> {
    const items = await this.callTats(areaCd, signguCd, tAtsNm);
    if (items.length === 0) return null;

    const target = normalizePlace(tAtsNm);
    const exact = items.filter((it) => normalizePlace(it.tAtsNm) === target);
    // 정확히 일치하는 게 없으면, LIKE 로 잡힌 관광지가 딱 하나일 때만 그걸 쓴다.
    // 여러 관광지가 섞여 있고 정확 일치가 없으면 오알림을 피해 포기한다.
    let rows = exact;
    if (rows.length === 0) {
      const names = new Set(items.map((it) => normalizePlace(it.tAtsNm)));
      if (names.size !== 1) return null;
      rows = items;
    }

    const ratesByYmd = new Map<string, number>();
    for (const r of rows) {
      const rate = Number(r.cnctrRate);
      if (Number.isFinite(rate)) ratesByYmd.set(String(r.baseYmd), rate);
    }
    if (ratesByYmd.size === 0) return null;

    const values = [...ratesByYmd.values()];
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    return { tAtsNm: rows[0]!.tAtsNm, ratesByYmd, mean };
  }

  /**
   * 주소에서 뽑은 시도명·시군구명을 tatsCnctrRatedList 가 요구하는 areaCd/signguCd 로 해석한다.
   * 시군구를 못 뽑거나 색인에 없으면 null(그 항목은 스캔에서 제외).
   */
  async resolveRegionCode(
    address: string,
  ): Promise<{ areaCd: string; signguCd: string } | null> {
    const sigunguName = parseSigungu(address);
    if (!sigunguName) return null;
    const sidoName = address.trim().split(/\s+/)[0] ?? '';
    if (!sidoName) return null;

    const sidoIdx = await this.loadSidoIndex();
    const areaCd = sidoIdx.get(regionStem(sidoName));
    if (!areaCd) return null;

    const sigunguIdx = await this.loadSigunguIndex(areaCd);
    const signguCd = sigunguIdx.get(normalizePlace(sigunguName));
    if (!signguCd) return null;

    return { areaCd, signguCd };
  }

  private loadSidoIndex(): Promise<Map<string, string>> {
    if (!this.sidoIndex) {
      this.sidoIndex = this.fetchLdong().then((items) => {
        const map = new Map<string, string>();
        // 시도명은 정식 전체명("강원특별자치도")으로 오므로 stem 으로 색인해 주소와 맞춘다.
        for (const it of items) map.set(regionStem(it.name), String(it.code));
        return map;
      });
    }
    return this.sidoIndex;
  }

  private loadSigunguIndex(areaCd: string): Promise<Map<string, string>> {
    let idx = this.sigunguIndexByArea.get(areaCd);
    if (!idx) {
      idx = this.fetchLdong(areaCd).then((items) => {
        const map = new Map<string, string>();
        // ldongCode2 시군구 code 는 3자리 지역 부분(예: 원주 '130')만 준다. 집중률 API 의
        // signguCd 는 법정동 5자리 전체(areaCd+3자리, 예: '51130')이므로 시도 코드를 붙인다.
        for (const it of items) {
          const signguCd = `${areaCd}${String(it.code).padStart(3, '0')}`;
          map.set(normalizePlace(it.name), signguCd);
        }
        return map;
      });
      this.sigunguIndexByArea.set(areaCd, idx);
    }
    return idx;
  }

  /** tatsCnctrRatedList 호출 → 아이템 배열. 쿼터 초과는 KtoQuotaExceededError 로 던진다. */
  private async callTats(
    areaCd: string,
    signguCd: string,
    tAtsNm: string,
  ): Promise<TatsCnctrItem[]> {
    const apiKey = this.apiKey();
    if (!apiKey) return [];
    const res = await axios.get<TatsCnctrResponse | string>(
      `${this.TATS_BASE}/tatsCnctrRatedList`,
      {
        params: {
          serviceKey: apiKey,
          numOfRows: 100,
          pageNo: 1,
          MobileOS: 'ETC',
          MobileApp: 'TriPick',
          _type: 'json',
          areaCd,
          signguCd,
          tAtsNm,
        },
        timeout: 15000,
      },
    );
    if (detectKtoQuota(res.data)) throw new KtoQuotaExceededError('tatsCnctrRatedList');
    if (typeof res.data === 'string') return [];
    const items = res.data.response?.body?.items;
    return toArray(items && typeof items !== 'string' ? items.item : undefined);
  }

  /** ldongCode2 호출 (지역코드 해석용). lDongRegnCd 미지정 → 시도, 지정 → 그 시도의 시군구. */
  private async fetchLdong(lDongRegnCd?: string): Promise<LdongItem[]> {
    const apiKey = this.apiKey();
    if (!apiKey) return [];
    const res = await axios.get<LdongResponse | string>(`${this.LDONG_BASE}/ldongCode2`, {
      params: {
        serviceKey: apiKey,
        numOfRows: 100,
        pageNo: 1,
        MobileOS: 'ETC',
        MobileApp: 'TriPick',
        _type: 'json',
        ...(lDongRegnCd ? { lDongRegnCd } : {}),
      },
      timeout: 15000,
    });
    if (detectKtoQuota(res.data)) throw new KtoQuotaExceededError('ldongCode2');
    if (typeof res.data === 'string') return [];
    const items = res.data.response?.body?.items;
    return toArray(items && typeof items !== 'string' ? items.item : undefined);
  }
}
