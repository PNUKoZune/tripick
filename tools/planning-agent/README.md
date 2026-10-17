# TriPick planning MCP + model agent

Python 3.10+ 표준 라이브러리만 사용합니다. 알고리즘, 권한, 잠금 보존, snapshot 버전 검사는 Nest API가 담당하고 Python은 MCP 연결과 실제 모델의 도구 선택을 실행합니다. 어떤 도구도 일정을 저장하거나 확정하지 않습니다.

## 로컬 테스트 (실제 모델 호출 없음)

저장소 루트에서 실행합니다.

```sh
PYTHONPATH=tools/planning-agent python3 -m unittest discover -s tools/planning-agent/tests -v
```

이 테스트의 scripted fake model은 실제 모델 실행 증빙이 아닙니다. 테스트는 모델 응답의 `tool_calls`를 받아 MCP 실행 결과를 다음 메시지로 전달하는 연결, 실패·예산·세션 보호를 검사합니다. 실제 stdio subprocess의 initialize → initialized → tools/list → tools/call 왕복도 포함합니다. 외부 API/모델은 테스트에서 호출하지 않습니다.

## MCP 서버

Nest API에 `PLANNING_TOOLS_ENABLED=true`를 설정하고 실행합니다. Local search 비교도 필요하면 `PLANNING_LOCAL_SEARCH_ENABLED=true`를 별도로 설정합니다. 발급받은 해당 사용자의 JWT를 환경변수로 전달합니다. 토큰을 명령행 인자, 도구 입력, 저장한 trace에 넣지 마세요.

```sh
export TRIPICK_API_URL=http://localhost:4000/api/v1
# TRIPICK_API_TOKEN: 별도 보안 환경에서 주입한 사용자 JWT
PYTHONPATH=tools/planning-agent python3 -m tripick_planning serve
```

MCP stdio 연결 명령은 `python3 -m tripick_planning serve`이며 `PYTHONPATH`를 이 디렉터리의 절대 경로로 지정합니다. stdin/stdout은 newline-delimited JSON-RPC 전용입니다. 도구 목록은 `get_planning_context`, `validate_itinerary`, `evaluate_itinerary`, `optimize_itinerary` 네 개입니다. 최적화는 서버에서 최대 50회/2초로 제한되는 동기 API를 사용하므로 작업 조회 도구를 광고하지 않습니다.

API의 고정 경로 `/trips/{tripId}/planning/{context|validate|evaluate|optimize}`에 POST합니다. 설정한 API origin 외에는 요청하지 않고 리다이렉트를 거부합니다. HTTPS는 원격 서버에 필수이며 HTTP는 localhost에만 허용합니다. API가 403을 반환하면 권한을 확인하세요. 도구 feature flag가 꺼져 있으면 404를 반환합니다. 409는 오래된 snapshot입니다.

## 실제 모델 실행

Chat Completions function calling을 지원하는 모델을 명시적으로 선택합니다. 사용자의 기존 기본 모델을 자동으로 변경하지 않습니다.

```sh
# OPENAI_API_KEY, PLANNING_MODEL: 보안 환경에서 사용할 키와 모델 ID 주입
# 선택 사항 OPENAI_BASE_URL (기본값 https://api.openai.com/v1)
PYTHONPATH=tools/planning-agent python3 -m tripick_planning run \
  --trip-id YOUR_OWNED_TRIP_ID \
  --request '필수 장소와 잠근 일정을 유지하면서 이동 시간을 줄인 초안을 제안해줘' \
  --locked-item-id LOCKED_ITEM_ID \
  --required-item-id REQUIRED_ITEM_ID \
  --timeout 60 \
  --trace planning.trace.jsonl
```

모델이 반환한 실제 `tool_calls`만 실행합니다. 실행 순서는 하드코딩하지 않으며 모델이 context/검증/평가/최적화를 선택합니다. MCP subprocess에는 모델 API 키를 전달하지 않습니다. API JWT는 Nest 호출에만 사용합니다.

모델에게 노출하는 schema에는 `lockedItemIds`, `requiredItemIds`가 없고 CLI에서 받은 값을 context 요청마다 주입합니다. 모든 호출의 trip ID, 활성 snapshot ID/버전, 항목의 trip ID를 검사합니다. 모델이 잠금이나 필수를 줄이는 인자 수정은 허용하지 않습니다. 잘못된 인자는 구조화된 오류로 모델에 돌려주며 최대 2회 수정 기회를 줍니다.

전체 실행 제한은 기본 60초(최대 300초), 도구 시도 최대 10회, 모델 재시도 전체 최대 2회입니다. 모든 대기는 전체 deadline을 적용합니다. Ctrl-C는 `CANCELLED` 종료로 기록합니다. 가장 최근 제안의 검증 결과가 `valid: true`, 위반 0개, `pinMisses: 0`이고 실제 일정 항목이 있어야 `completed`가 됩니다. 최적화 응답을 받은 뒤에는 다시 검증해야 합니다. 시간 초과·도구 timeout·도구 예산 초과에서 이전 검증안을 반환할 때는 `candidateIsFallback: true`를 명시하며 완료로 표시하지 않습니다. 종료 코드 0은 완료, 2는 미완료/실패입니다.

JSON 결과와 선택적 JSONL trace는 `agent_started`, `model_call`, `model_response`, `tool_call`, `tool_result`, `tool_rejected`, `tool_failure`, `agent_finished`를 구분합니다. 초기 이벤트에는 모델 ID, 초기 프롬프트 SHA256 해시, 프롬프트 버전, 호출·재시도·시간 예산이 남습니다. 모델 응답에 usage가 있으면 호출별 입력/출력/합계 토큰 수와 전체 합계, usage가 확인된 호출 수를 기록합니다. usage가 없으면 토큰 수를 추정하지 않고 `null`로 남깁니다. trace에는 도구 입력·프롬프트 원문·인증 정보를 기록하지 않습니다. 후보 상세와 여행 정보가 포함된 최종 JSON은 외부에 공유하기 전에 확인하세요. `unknownConstraints`는 확인된 제약 만족으로 간주하지 않습니다.

실제 모델·인증 API smoke는 유효한 키/JWT/여행이 있는 환경에서 위 명령으로 별도 실행하고, fake 테스트 결과와 구분해 보고해야 합니다. 성공률·비용·A/B/C/D 우열은 이 연결 코드만으로 입증되지 않습니다.

공식 계약: [MCP stdio](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports), [MCP tools](https://modelcontextprotocol.io/specification/2025-06-18/server/tools), [OpenAI Chat Completions](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create).
