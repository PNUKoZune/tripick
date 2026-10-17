"""A real subprocess MCP client with bounded waits and explicit lifecycle."""

import json
import os
import queue
import subprocess
import sys
import threading
import time

from .contracts import PlanningError


class StdioMcpClient:
    def __init__(self, command=None, env=None):
        self.command = command or [sys.executable, "-m", "tripick_planning.mcp_server"]
        self.env = dict(os.environ if env is None else env)
        # The child only calls Nest. It has no reason to receive the model credential.
        self.env.pop("OPENAI_API_KEY", None)
        self.process, self.sequence = None, 0
        self.incoming = queue.Queue()

    def start(self):
        if self.process is not None:
            return
        self.process = subprocess.Popen(self.command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                        stderr=subprocess.DEVNULL, env=self.env)
        threading.Thread(target=self._read, daemon=True).start()

    def _read(self):
        while True:
            raw = self.process.stdout.readline(4 * 1024 * 1024 + 1)
            if not raw:
                self.incoming.put(None)
                return
            if len(raw) > 4 * 1024 * 1024:
                self.incoming.put(PlanningError("MCP_PROTOCOL_ERROR", "MCP response exceeded the size limit"))
                return
            try:
                self.incoming.put(json.loads(raw))
            except (ValueError, UnicodeError):
                self.incoming.put(PlanningError("MCP_PROTOCOL_ERROR", "MCP returned invalid JSON"))
                return

    def notify(self, method, params=None):
        self._write({"jsonrpc": "2.0", "method": method, "params": params or {}})

    def _write(self, value):
        self.start()
        try:
            self.process.stdin.write((json.dumps(value, allow_nan=False) + "\n").encode("utf-8"))
            self.process.stdin.flush()
        except (BrokenPipeError, OSError):
            raise PlanningError("MCP_DISCONNECTED", "MCP process disconnected") from None

    def request(self, method, params=None, timeout=10.0):
        if timeout <= 0:
            raise PlanningError("DEADLINE_EXCEEDED", "MCP deadline exceeded")
        self.sequence += 1
        request_id = self.sequence
        self._write({"jsonrpc": "2.0", "id": request_id, "method": method, "params": params or {}})
        deadline = time.monotonic() + timeout
        while True:
            try:
                response = self.incoming.get(timeout=max(0, deadline - time.monotonic()))
            except queue.Empty:
                # Do not reuse a process whose result may arrive after this request times out.
                self.close()
                raise PlanningError("TOOL_TIMEOUT", "MCP request timed out", retryable=True) from None
            if response is None:
                raise PlanningError("MCP_DISCONNECTED", "MCP process ended")
            if isinstance(response, PlanningError):
                raise response
            if not isinstance(response, dict) or response.get("jsonrpc") != "2.0":
                raise PlanningError("MCP_PROTOCOL_ERROR", "MCP returned an invalid response")
            if "id" not in response:  # Server notifications need no reply for this tool-only client.
                continue
            if response["id"] != request_id:
                raise PlanningError("MCP_PROTOCOL_ERROR", "MCP response id did not match")
            if "error" in response:
                error = response["error"]
                raise PlanningError("MCP_REQUEST_ERROR", "MCP rejected the request",
                                    details={"rpcCode": error.get("code") if isinstance(error, dict) else None})
            if "result" not in response:
                raise PlanningError("MCP_PROTOCOL_ERROR", "MCP result is missing")
            return response["result"]

    def initialize(self, timeout=10.0):
        result = self.request("initialize", {"protocolVersion": "2025-06-18", "capabilities": {},
                                            "clientInfo": {"name": "tripick-agent", "version": "0.1.0"}}, timeout)
        if result.get("protocolVersion") != "2025-06-18":
            raise PlanningError("MCP_PROTOCOL_ERROR", "MCP protocol version is unsupported")
        self.notify("notifications/initialized")
        return result

    def list_tools(self, timeout=10.0):
        return self.request("tools/list", timeout=timeout)["tools"]

    def call_tool(self, name, arguments, timeout=10.0):
        return self.request("tools/call", {"name": name, "arguments": arguments}, timeout)

    def close(self):
        if self.process is None:
            return
        if self.process.poll() is None:
            self.process.terminate()
            try:
                self.process.wait(timeout=0.5)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait(timeout=0.5)
        for stream in (self.process.stdin, self.process.stdout):
            if stream:
                stream.close()

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()
