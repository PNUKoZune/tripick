export type TripStatus = 'draft' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled';

/**
 * 정본 이동 수단. 경로·ETA 분기는 표시용 라벨이 아니라 이 값으로 한다.
 * 값을 추가하면 RouteHelper.getEta 의 switch 가 컴파일 타임에 누락을 잡는다.
 */
export type RouteMode = 'walk' | 'transit' | 'car';

export interface TripDto {
  id: string;
  userId: string;
  title: string;
  destination: string;
  startDate: string;
  endDate: string;
  status: TripStatus;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTripDto {
  title: string;
  destination: string;
  /**
   * 일자별 지역 목록. 인덱스 i = (i+1)일차, 각 원소는 그 날의 지역 배열(하루 여러 지역 허용).
   * 생략 시 모든 날을 `destination` 하나로 채운다. 있으면 길이는 여행 일수와 같아야 한다.
   */
  dayRegions?: string[][];
  startDate: string;
  endDate: string;
  /** 취침 시간 (HH:mm) */
  sleepTime?: string;
  /** 기상 시간 (HH:mm) */
  wakeTime?: string;
  /** 선호 이동 수단: walk | transit | car */
  transportMode?: RouteMode;
  notes?: string;
}

export interface UpdateTripDto {
  title?: string;
  status?: TripStatus;
  sleepTime?: string;
  wakeTime?: string;
  transportMode?: RouteMode;
  notes?: string | null;
}
