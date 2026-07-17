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
