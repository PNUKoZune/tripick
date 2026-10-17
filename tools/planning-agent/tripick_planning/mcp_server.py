"""MCP 2025-06-18 newline-delimited stdio transport. Stdout is JSON-RPC only."""

import json
import sys

from .contracts import PlanningError, tool_definitions, tool_result
from .http_client import PlanningApi

MAX_LINE_BYTES = 2 * 1024 * 1024


class McpServer:
    def __init__(self, api=None):
        self.api = api
        self.initialized = False
        self.ready = False

    @staticmethod
    def failure(request_id, code, message):
        return {"jsonrpc": "2.0", "id": request_id, "error": {"code": code, "message": message}}

    def handle(self, request):
        if not isinstance(request, dict) or request.get("jsonrpc") != "2.0" or not isinstance(request.get("method"), str):
            return self.failure(None, -32600, "Invalid request")
        request_id = request.get("id")
        if "id" in request and (isinstance(request_id, bool) or not isinstance(request_id, (int, str))):
            return self.failure(None, -32600, "Invalid request id")
        method, params = request["method"], request.get("params", {})
        if not isinstance(params, dict):
            return None if "id" not in request else self.failure(request_id, -32602, "Invalid params")
        if method == "notifications/initialized":
            if self.initialized:
                self.ready = True
            return None
        if "id" not in request:
            return None
        if method == "initialize":
            if self.initialized:
                return self.failure(request_id, -32600, "Already initialized")
            if not isinstance(params.get("protocolVersion"), str) or not isinstance(params.get("clientInfo"), dict):
                return self.failure(request_id, -32602, "Invalid initialize params")
            self.initialized = True
            result = {"protocolVersion": "2025-06-18", "capabilities": {"tools": {"listChanged": False}},
                      "serverInfo": {"name": "tripick-planning", "version": "0.1.0"},
                      "instructions": "Draft-only planning. No tool can save or publish an itinerary."}
        elif method == "ping":
            result = {}
        elif not self.ready:
            return self.failure(request_id, -32002, "Server not initialized")
        elif method == "tools/list":
            if params:
                return self.failure(request_id, -32602, "Pagination is not supported")
            result = {"tools": tool_definitions()}
        elif method == "tools/call":
            if set(params) - {"name", "arguments", "_meta"} or not isinstance(params.get("name"), str):
                return self.failure(request_id, -32602, "Invalid tool call params")
            try:
                api = self.api or PlanningApi()
                result = tool_result(api.call(params["name"], params.get("arguments", {})))
            except PlanningError as exc:
                result = tool_result(error=exc)
            except Exception:
                # Never leak tokens, request bodies, or Python tracebacks across the tool boundary.
                result = tool_result(error=PlanningError("INTERNAL_ERROR", "Planning tool failed"))
        else:
            return self.failure(request_id, -32601, "Method not found")
        return {"jsonrpc": "2.0", "id": request_id, "result": result}

    def serve(self, source=None, sink=None):
        source, sink = source or sys.stdin.buffer, sink or sys.stdout
        while True:
            raw = source.readline(MAX_LINE_BYTES + 1)
            if not raw:
                break
            if len(raw) > MAX_LINE_BYTES:
                # Drain this frame before reading the next JSON-RPC message.
                while raw and not raw.endswith(b"\n"):
                    raw = source.readline(MAX_LINE_BYTES + 1)
                response = self.failure(None, -32700, "Message exceeded size limit")
            else:
                try:
                    request = json.loads(raw, parse_constant=lambda _: (_ for _ in ()).throw(ValueError()))
                    response = self.handle(request)
                except (ValueError, UnicodeError):
                    response = self.failure(None, -32700, "Parse error")
            if response is not None:
                sink.write(json.dumps(response, ensure_ascii=False, allow_nan=False) + "\n")
                sink.flush()


def main():
    McpServer().serve()


if __name__ == "__main__":
    main()
