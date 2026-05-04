export interface PlaceDto {
    id: string;
    kakaoPlaceId?: string;
    tourismApiId?: string;
    name: string;
    category: string;
    address: string;
    roadAddress?: string;
    phone?: string;
    coordinates: {
        lat: number;
        lng: number;
    };
    openingHours?: string;
    imageUrl?: string;
    rating?: number;
    reviewCount?: number;
}
export interface PlaceSearchResultDto {
    places: PlaceDto[];
    totalCount: number;
    page: number;
}
//# sourceMappingURL=place.d.ts.map