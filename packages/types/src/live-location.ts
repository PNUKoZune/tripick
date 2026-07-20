/**
 * 실시간 위치 인제스트 DTO.
 *
 * 여행 진행(Live) 중 클라이언트가 서버에 현재 위치를 주기적으로 보고한다.
 * 서버는 이 위치를 캐시해두었다가, 일정 항목 시작 시각(+유예)에 도착 여부를 판정해
 * 미도착이면 `arrival_alert` 알림을 보낸다. 자동 재계획은 하지 않는다.
 */
export interface UpdateLiveLocationDto {
  lat: number;
  lng: number;
  /** GPS 정확도(m). 있으면 서버가 참고용으로 보관 */
  accuracy?: number;
}
