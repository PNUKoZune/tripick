"""Run the real model/MCP path. Credentials are read only from environment."""

import argparse
import json
import sys

from .agent import ChatCompletionsModel, PlanningAgent
from .contracts import PlanningError
from .mcp_client import StdioMcpClient
from .mcp_server import main as serve


def main():
    parser = argparse.ArgumentParser(description="TriPick draft-only MCP planning agent")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("serve", help="Run the MCP stdio adapter")
    run = sub.add_parser("run", help="Run actual model-selected tool calls through MCP")
    run.add_argument("--trip-id", required=True)
    run.add_argument("--request", required=True)
    run.add_argument("--locked-item-id", action="append", default=[])
    run.add_argument("--required-item-id", action="append", default=[])
    run.add_argument("--timeout", type=float, default=60)
    run.add_argument("--max-tool-calls", type=int, default=10)
    run.add_argument("--trace", help="Write JSONL event metadata (never prompts or credentials)")
    args = parser.parse_args()
    if args.command == "serve":
        serve()
        return 0
    trace_file = None
    try:
        if args.trace:
            trace_file = open(args.trace, "w", encoding="utf-8")

        def trace(record):
            if trace_file:
                trace_file.write(json.dumps(record, ensure_ascii=False) + "\n")
                trace_file.flush()

        model = ChatCompletionsModel()
        with StdioMcpClient() as mcp:
            result = PlanningAgent(mcp, model, args.trip_id,
                                   locked_item_ids=args.locked_item_id, required_item_ids=args.required_item_id,
                                   timeout=args.timeout, max_tool_calls=args.max_tool_calls,
                                   trace_sink=trace).run(args.request)
        print(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False))
        return 0 if result["status"] == "completed" else 2
    except PlanningError as exc:
        print(json.dumps({"status": "failed", "saved": False, "error": exc.as_dict()}, ensure_ascii=False))
        return 2
    finally:
        if trace_file:
            trace_file.close()


if __name__ == "__main__":
    sys.exit(main())
