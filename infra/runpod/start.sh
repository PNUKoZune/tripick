#!/bin/bash
# llama-server 두 개를 한 컨테이너에서 띄운다 — chat(+vision) 과 임베딩.
#
# 둘을 나란히 두는 이유는 VRAM 이 남아서다: 26B Q4 가 ~16GB, mmproj 가 ~1.5GB,
# BGE-m3 가 ~1.2GB 라 24GB 카드 한 장에 들어간다. 파드를 나누면 GPU 값을 두 번 낸다.
set -euo pipefail

: "${CHAT_HF:?CHAT_HF is required}"
: "${EMBED_HF:?EMBED_HF is required}"
CHAT_PORT="${CHAT_PORT:-8080}"
EMBED_PORT="${EMBED_PORT:-8081}"
CHAT_CTX="${CHAT_CTX:-16384}"
EMBED_CTX="${EMBED_CTX:-8192}"
EMBED_POOLING="${EMBED_POOLING:-cls}"
# thinking 모델(gemma-4 -it 등)은 출력을 message.reasoning_content 로 보내고 content 를 비운다.
# 우리 플래너는 content 만 읽고 비면 '{}' 로 폴백하므로(planner-agent.service.ts), 그대로 두면
# LLM 이 살아 있는데도 매번 결정적 폴백으로 빠진다 — 에러가 안 나서 알아채기 어렵다.
# 0 = thinking 즉시 종료. 일정 JSON 생성엔 사고 과정이 필요 없고 토큰·지연만 늘린다.
REASONING_BUDGET="${REASONING_BUDGET:-0}"

# API 키는 선택. 넣으면 두 서버 모두 같은 키를 요구한다 —
# RunPod 프록시 URL 은 인증이 없어 주소만 알면 누구나 GPU 를 쓸 수 있다.
auth=()
if [ -n "${LLAMA_API_KEY:-}" ]; then
  auth=(--api-key "$LLAMA_API_KEY")
fi

echo "[start] chat=$CHAT_HF :$CHAT_PORT (ctx=$CHAT_CTX)"
echo "[start] embed=$EMBED_HF :$EMBED_PORT (ctx=$EMBED_CTX, pooling=$EMBED_POOLING)"
echo "[start] cache=${LLAMA_CACHE:-<default>}"

# chat — mmproj 는 -hf 저장소에 함께 있으면 llama.cpp 가 자동으로 붙인다(멀티모달).
/app/llama-server \
  -hf "$CHAT_HF" \
  --host 0.0.0.0 --port "$CHAT_PORT" \
  -ngl 99 -c "$CHAT_CTX" --jinja \
  --reasoning-budget "$REASONING_BUDGET" \
  "${auth[@]}" &
chat_pid=$!

# embedding — BGE-m3 의 dense 벡터는 CLS 풀링이다. 잘못 잡으면 차원은 맞는데
# 좌표계가 달라져 검색이 조용히 나빠지므로 명시한다.
/app/llama-server \
  -hf "$EMBED_HF" \
  --host 0.0.0.0 --port "$EMBED_PORT" \
  -ngl 99 -c "$EMBED_CTX" \
  --embeddings --pooling "$EMBED_POOLING" \
  "${auth[@]}" &
embed_pid=$!

# 한쪽이 죽으면 컨테이너를 내린다 — 반쪽만 살아 있으면 플래너는 되는데 검색이 조용히
# 폴백으로 빠지는 상태가 되어, 헬스체크로도 안 잡히고 품질만 떨어진다.
trap 'kill -TERM $chat_pid $embed_pid 2>/dev/null || true' TERM INT
wait -n
echo "[start] a server exited — shutting down the container" >&2
kill -TERM $chat_pid $embed_pid 2>/dev/null || true
wait || true
exit 1
