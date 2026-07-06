# feat: 여행 지역 선택 관광공사 API 연동 + 지도에서 선택

## 요약

여행 생성 폼의 "여행 지역" 입력을 하드코딩 fixture에서 **한국관광공사 국문관광정보 API**(data.go.kr 15101578) 연동으로 교체하고, **지도에서 지역을 선택**하는 기능을 추가했습니다.

- 자동완성: `areaCode2`로 전국 17 시도 + 234 시군구(총 251건) 실데이터 제공, 빈 검색 시 인기 여행지 우선 노출
- 지도 선택: 지도 탭 지점을 `services.Geocoder`로 역지오코딩해 행정구역 확정, `services.Places`로 장소 검색 이동
- 하드코딩 fallback fixture 제거

## 변경 사항

### 백엔드 (자동완성)
- `DestinationsService` 신규 — 관광공사 `areaCode2` 조회, 시도+시군구 평탄화, 인기 우선순위, 프로세스 메모리 캐싱
- `data.go.kr` 응답(`items`가 `''`·단일객체·배열) 정규화 방어 처리
- 컨트롤러를 `searchDestinationFallbacks` → `destinationsService.search()`로 교체, `destinations.fallback.ts` 삭제

### 프론트 (지도 선택)
- `DestinationMapPicker` 신규 — `BottomSheet` 안 카카오 지도, 탭→역지오코딩→확정, 장소 검색 이동
- `kakao-loader`에 `event`·`services`(Geocoder/Places) 타입, `Marker.setPosition` 추가
- 여행 지역 입력 옆에 지도 버튼 배치

## 환경변수
- `apps/api/.env` : `KTO_API_KEY` (data.go.kr 국문관광정보 GW 인증키, 기상청 키와 공통 사용 가능)
- 키 미설정 시 지역 목록 빈 배열 (fallback 제거됨)

## 검증
- `areaCode2` 실호출 `resultCode 0000 OK`, 251건 확인
- 빈 검색 → `제주·부산·강릉시·경주시·여수시·전주시·속초시·서울`
- `apps/api`·`apps/web` `tsc --noEmit` 통과, `/trips/new` dev 컴파일 200
- lint: 저장소에 eslint config 미설정 + Next 16 `next lint` 제거로 스킵

## 스크린샷
_(웹에서 지도 선택 동작 캡처 첨부 예정)_

## 후속 (별도 PR)
- `PLACE_SEEDS` 일정 카탈로그를 `areaBasedList2` 실데이터로 교체
- 영업시간 제약(`detailIntro2`)·재계획 대안 후보(`locationBasedList2`) 연동

상세 문서: [`docs/destination-tour-api-v1.md`](../destination-tour-api-v1.md)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
