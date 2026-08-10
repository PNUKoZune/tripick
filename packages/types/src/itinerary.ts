export type ItineraryItemType = 'attraction' | 'restaurant' | 'cafe' | 'accommodation' | 'transport';

export interface Coordinates {
  lat: number;
  lng: number;
}

export interface ItineraryItemDto {
  id: string;
  tripId: string;
  day: number;
  order: number;
  type: ItineraryItemType;
  name: string;
  address: string;
  coordinates: Coordinates;
  /** 방문 예정 시작 시간 (ISO 8601) */
  scheduledAt: string;
  /** 예상 체류 시간 (분) */
  durationMin: number;
  /** 다음 장소까지 이동 시간 (분) */
  travelTimeMin?: number;
  openingHours?: string;
  phoneNumber?: string;
  kakaoPlaceId?: string;
  imageUrl?: string;
  memo?: string;
}

export interface CreateItineraryItemDto {
  tripId: string;
  day: number;
  order: number;
  type: ItineraryItemType;
  name: string;
  address: string;
  coordinates: Coordinates;
  scheduledAt: string;
  durationMin: number;
  travelTimeMin?: number;
  openingHours?: string;
  phoneNumber?: string;
  kakaoPlaceId?: string;
  imageUrl?: string;
  memo?: string;
}
