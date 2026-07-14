# OpenTripPlanner 2 (OTP) — 대중교통/자동차 통합 길찾기 (테스트용)

GTFS(대중교통) + OSM(자동차·도보) 데이터를 하나의 그래프로 빌드해, 대중교통과 자동차 경로를 모두 조회할 수 있는 OTP 서버를 로컬 도커로 띄운다.

기존 TMAP/ODsay 호출을 대체·비교하기 위한 **별도 테스트 스택**이며, `docker compose up` 기본 실행에는 포함되지 않는다 (compose `profiles` 로 분리).

---

## 1. 데이터 파일 위치

모든 입력·설정·산출물은 이 폴더의 `data/` 아래에 둔다. 컨테이너의 `/var/opentripplanner` 로 마운트된다.

```
infra/otp/data/
├── <지역>.osm.pbf        # ① OSM 도로망 (자동차/도보) — 필수
├── <지역>.gtfs.zip       # ② GTFS 대중교통 (여러 개 가능) — 필수
├── build-config.json     # (선택) 그래프 빌드 옵션
├── router-config.json    # (선택) 라우팅 런타임 옵션
└── graph.obj             # ③ 빌드 결과물 (--build 시 자동 생성, 커밋 안 함)
```

파일명 규칙:

- **OSM**: 확장자가 `.osm.pbf` 또는 `.pbf` 면 자동 인식.
- **GTFS**: 확장자가 `.zip` 인 파일을 GTFS 로 인식. 여러 지역/기관 GTFS 를 넣으려면 zip 을 여러 개 두면 된다. (혼동 방지로 `*.gtfs.zip` 권장)
- `data/` 안의 대용량 파일(`.pbf`, `.zip`, `graph.obj`)은 `.gitignore` 로 커밋에서 제외된다. `.json` 설정과 README 만 버전 관리된다.

### 데이터 받는 곳 (참고)

- **OSM PBF (한국)**: <https://download.geofabrik.de/asia/south-korea-latest.osm.pbf>
  - 전국은 크다. 테스트는 [BBBike extract](https://extract.bbbike.org/) 로 특정 도시/영역만 잘라 쓰는 걸 권장.
- **GTFS (한국)**: 국가대중교통정보센터(TAGO)/공공데이터포털 등에서 지역별 GTFS zip 확보.

> 전국 GTFS+OSM 을 한 번에 빌드하면 메모리를 많이 먹는다. 먼저 한 도시 규모로 검증 후 확장할 것.

---

## 2. 실행 순서

### ① 그래프 빌드 (최초 1회 / 데이터 교체 시)

`data/` 에 `.osm.pbf` 와 `.gtfs.zip` 을 넣은 뒤:

```bash
docker compose --profile otp-build up otp-build
```

- `--build --save` 로 실행되어 `data/graph.obj` 를 생성한다.
- 완료되면 컨테이너는 종료된다 (`restart: "no"`).

### ② 서버 기동

```bash
docker compose --profile otp up -d otp
```

- `--load --serve` 로 `graph.obj` 를 읽어 서버를 띄운다.
- 접속: <http://localhost:8090> (컨테이너 8080 → 호스트 **8090**, LLM 서버와 충돌 회피)
  - Web UI / GraphQL: `http://localhost:8090`
  - GraphQL 엔드포인트: `http://localhost:8090/otp/gtfs/v1`

### 중지

```bash
docker compose --profile otp down
```

---

## 3. 메모리 튜닝 (`OTP_MAX_HEAP`)

전국(south-korea) 데이터 기준 실측 요건 — compose 기본값에 반영돼 있다:

| 단계 | compose 기본 힙 | 비고 |
| ---- | --------------- | ---- |
| 빌드 (`otp-build`) | `13g` | `stop_times` 매핑 피크. 8g 는 OOM. 소요 약 11분, `graph.obj` ~1.3GB |
| 서빙 (`otp`) | `10g` | graph.obj 로딩 + Raptor 인덱스 상주. 실측 ~10.6GiB |

> ⚠️ 물리 16GB(WSL2 ~15.4Gi) 기준으로 빡빡하다. 전국을 서빙하면 10g 를 상주로 물기 때문에
> LLM 서버 등과 동시 구동이 어렵다. 권역만 다룰 땐 아래처럼 낮춰 쓴다.

권역/도시 단위면 더 낮게:

```bash
OTP_MAX_HEAP=6g docker compose --profile otp-build up otp-build
OTP_MAX_HEAP=6g docker compose --profile otp up -d otp
```

빌드가 OOM(exit 1) 또는 컨테이너 강제 종료(exit 137)로 죽으면 이 값을 조정할 것.
(WSL2 는 `.wslconfig` 의 `memory` 한도도 함께 확인)

---

## 4. 빠른 확인 (자동차/대중교통 경로 질의)

서버 기동 후 GraphQL 로 두 좌표 간 경로를 요청해 응답이 오는지 확인:

```bash
curl -s http://localhost:8090/otp/gtfs/v1 \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ plan(from:{lat:37.5665,lon:126.9780}, to:{lat:37.5796,lon:126.9770}, transportModes:[{mode:TRANSIT},{mode:WALK}]) { itineraries { duration walkDistance legs { mode duration } } } }"}'
```

`transportModes` 를 `[{mode:CAR}]` 로 바꾸면 자동차 경로가 조회된다.

버전: `opentripplanner/opentripplanner:2.9.0` (docker-compose.yml 에 고정)
