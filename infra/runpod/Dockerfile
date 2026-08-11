# TriPick LLM 서빙 이미지 — chat(+vision) 과 임베딩을 한 컨테이너에서 함께 띄운다.
#
# 왜 커스텀 이미지가 필요한가:
# RunPod 파드는 컨테이너 하나이고, v2 API 는 컨테이너에 `args` 만 넘긴다(entrypoint 교체 불가).
# 공식 llama.cpp server 이미지의 entrypoint 는 `/app/llama-server` 라, 무엇을 넣든 그 한 프로세스의
# 인자가 되어 두 번째 서버를 띄울 수가 없다. entrypoint 를 쉘 스크립트로 바꾸는 것이 이 이미지의 전부다.
#
# 빌드(모노레포 어디서든):
#   docker build -f infra/runpod/Dockerfile -t <registry>/<ns>/tripick-llm:latest infra/runpod
FROM ghcr.io/ggml-org/llama.cpp:server-cuda

COPY start.sh /usr/local/bin/start.sh
RUN chmod +x /usr/local/bin/start.sh

# 기본값. RunPod 템플릿 env 로 덮어쓴다.
ENV CHAT_HF=unsloth/gemma-4-26B-A4B-it-GGUF:UD-Q4_K_M \
    EMBED_HF=CHKH01/BGE-m3-ko-GGUF:f16 \
    CHAT_PORT=8080 \
    EMBED_PORT=8081 \
    CHAT_CTX=16384 \
    EMBED_CTX=8192 \
    EMBED_POOLING=cls \
    LLAMA_CACHE=/workspace/models

EXPOSE 8080 8081

ENTRYPOINT ["/usr/local/bin/start.sh"]
