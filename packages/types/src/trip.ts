export type TripStatus = 'draft' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled';

export interface TripDto {
  id: string;
  userId: string;
  title: string;
  destination: string;
  startDate: string;
  endDate: string;
  status: TripStatus;
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
  transportMode?: 'walk' | 'transit' | 'car';
}

export interface UpdateTripDto {
  title?: string;
  status?: TripStatus;
  sleepTime?: string;
  wakeTime?: string;
  transportMode?: 'walk' | 'transit' | 'car';
}
