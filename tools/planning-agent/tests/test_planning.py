import copy
import io
import json
import os
import socket
import sys
import time
import unittest
import urllib.error
from unittest.mock import patch

from tripick_planning.agent import ChatCompletionsModel, PlanningAgent
from tripick_planning.contracts import PlanningError, TOOL_SCHEMAS, tool_definitions, tool_result, validate
from tripick_planning.http_client import NoRedirect, PlanningApi, checked_base_url, json_post
from tripick_planning.mcp_client import StdioMcpClient
from tripick_planning.mcp_server import McpServer


def call(name, args, ident="call-1"):
    return {"role": "assistant", "content": None, "tool_calls": [
        {"id": ident, "type": "function", "function": {"name": name, "arguments": json.dumps(args)}}]}


def context(locked=(), required=()):
    return {"schemaVersion": "1", "algorithmVersion": "baseline-v1", "snapshotId": "snapshot-a",
            "snapshotVersion": "sha256-a", "constraintVersion": "1", "candidateId": "candidate-a",
            "trip": {"id": "trip-a"}, "items": [], "candidates": [],
            "lockedItemIds": list(locked), "requiredItemIds": list(required)}


def candidate():
    return {"schemaVersion": "1", "algorithmVersion": "baseline-v1", "snapshotId": "snapshot-a",
            "snapshotVersion": "sha256-a", "constraintVersion": "1", "candidateId": "candidate-a",
            "normalizedItems": [{"id": "p1", "tripId": "trip-a", "day": 1, "order": 0,
                                 "scheduledAt": "2026-10-20T09:00:00+09:00", "durationMin": 60}],
            "valid": True, "metrics": {"pinMisses": 0, "shortfall": 0}, "violations": [],
            "unknownConstraints": [{"code": "OPENING_HOURS_UNKNOWN"}], "terminationReason": "VALIDATED"}


CANDIDATE_ARGS = {"tripId": "trip-a", "snapshotId": "snapshot-a", "snapshotVersion": "sha256-a",
                  "candidateId": "candidate-a"}


class FakeMcp:
    def __init__(self, results=None):
        self.calls, self.initialized, self.listed = [], False, False
        self.results = results or {}

    def initialize(self, timeout):
        self.initialized = True
        return {"protocolVersion": "2025-06-18"}

    def list_tools(self, timeout):
        assert self.initialized
        self.listed = True
        return tool_definitions()

    def call_tool(self, name, arguments, timeout):
        assert self.listed
        self.calls.append((name, copy.deepcopy(arguments), timeout))
        result = self.results.get(name)
        if isinstance(result, Exception):
            raise result
        if result is not None:
            return result
        return tool_result(context(arguments.get("lockedItemIds", []), arguments.get("requiredItemIds", []))
                           if name == "get_planning_context" else candidate())


class ScriptedModel:
    """Test fixture. Deliberately never described as a real-model trace."""
    def __init__(self, messages):
        self.responses, self.inputs = list(messages), []

    def complete(self, messages, tools, timeout):
        self.inputs.append((copy.deepcopy(messages), copy.deepcopy(tools), timeout))
        result = self.responses.pop(0)
        if isinstance(result, Exception):
            raise result
        return result


class ContractsTests(unittest.TestCase):
    def test_all_nested_object_schemas_are_closed_and_have_no_auth(self):
        def check(schema):
            if schema.get("type") == "object":
                self.assertIs(schema["additionalProperties"], False)
                self.assertFalse({"token", "apiKey", "authorization"} & set(schema["properties"]))
                for child in schema["properties"].values():
                    check(child)
            if "items" in schema:
                check(schema["items"])
        for schema in TOOL_SCHEMAS.values():
            check(schema)

    def test_bad_values_are_rejected_including_nonfinite_coordinates(self):
        for args in ({"tripId": "a", "token": "secret"}, {"tripId": True},
                     {"tripId": "a", "lockedItemIds": [{}]},
                     {"tripId": "a", "requiredItemIds": ["x", "x"]}):
            with self.subTest(args=args), self.assertRaises(PlanningError):
                validate(args, TOOL_SCHEMAS["get_planning_context"])
        for value in (True, 0, 51, float("inf")):
            with self.subTest(value=value), self.assertRaises(PlanningError):
                validate({**CANDIDATE_ARGS, "maxEvaluations": value}, TOOL_SCHEMAS["optimize_itinerary"])

    def test_minimal_item_contract(self):
        args = {**CANDIDATE_ARGS, "items": [{"id": "p1", "day": 1, "order": 0,
                                           "scheduledAt": "2026-10-20T09:00:00+09:00", "durationMin": 60}]}
        validate(args, TOOL_SCHEMAS["validate_itinerary"])
        args["items"][0]["coordinates"] = {"lat": float("nan"), "lng": 127}
        with self.assertRaises(PlanningError):
            validate(args, TOOL_SCHEMAS["validate_itinerary"])


class ApiTests(unittest.TestCase):
    def test_only_allowlisted_encoded_post_paths_and_no_token_in_body(self):
        calls = []
        api = PlanningApi("http://localhost:4000/api/v1", "secret-token",
                          transport=lambda *args: calls.append(args) or {"ok": True})
        api.call("get_planning_context", {"tripId": "a/b?x=1"})
        self.assertEqual(calls[0][0], "http://localhost:4000/api/v1/trips/a%2Fb%3Fx%3D1/planning/context")
        self.assertEqual(calls[0][1], {})
        self.assertEqual(calls[0][2], "secret-token")
        with self.assertRaises(PlanningError):
            api.call("save_itinerary", {"tripId": "a"})
        self.assertEqual(len(calls), 1)

    def test_default_url_has_api_prefix_and_does_not_log_token(self):
        with patch.dict(os.environ, {}, clear=True):
            api = PlanningApi(token="secret-token", transport=lambda *_: {})
        self.assertEqual(api.base_url, "http://localhost:4000/api/v1")
        self.assertNotIn("secret-token", str(tool_definitions()))

    def test_rejects_untrusted_urls_and_redirects(self):
        for url in ("file:///etc/passwd", "http://example.com", "https://u:p@example.com", "https://a?q=b",
                    "https://a/#frag", "https://a:bad", "https://a:0"):
            with self.subTest(url=url), self.assertRaises(PlanningError):
                checked_base_url(url)
        self.assertIsNone(NoRedirect().redirect_request(None, None, 302, "Found", {}, "https://other.example"))

    def test_http_timeout_and_error_do_not_leak_upstream_body(self):
        class Fail:
            def __init__(self, exc):
                self.exc = exc
            def open(self, *_, **__):
                raise self.exc
        for error, expected in ((socket.timeout(), "TOOL_TIMEOUT"),
                                (urllib.error.HTTPError("url", 409, "secret-token", {}, None), "STALE_SNAPSHOT")):
            with self.subTest(expected=expected), self.assertRaises(PlanningError) as raised:
                json_post("http://localhost", {}, "secret-token", 1, Fail(error))
            self.assertEqual(raised.exception.code, expected)
            self.assertNotIn("secret-token", str(raised.exception.as_dict()))

    def test_http_headers_and_timeout_are_bound(self):
        class Response:
            def __enter__(self): return self
            def __exit__(self, *_): pass
            def read(self, _): return b'{"ok":true}'
        class Capture:
            def open(self, request, timeout):
                self.request, self.timeout = request, timeout
                return Response()
        capture = Capture()
        self.assertEqual(json_post("http://localhost", {"a": 1}, "jwt", 0.5, capture), {"ok": True})
        self.assertEqual(capture.request.get_header("Authorization"), "Bearer jwt")
        self.assertEqual(capture.request.get_method(), "POST")
        self.assertEqual(capture.timeout, 0.5)

    def test_items_cannot_change_trip(self):
        item = {"id": "p1", "day": 1, "order": 0, "tripId": "other", "scheduledAt": "now", "durationMin": 60}
        api = PlanningApi(token="test-token", transport=lambda *_: self.fail("must not send"))
        with self.assertRaises(PlanningError) as raised:
            api.call("validate_itinerary", {**CANDIDATE_ARGS, "items": [item]})
        self.assertEqual(raised.exception.code, "TRIP_MISMATCH")


class McpTests(unittest.TestCase):
    def test_stdio_server_protocol_and_tool_failure_continues(self):
        class Api:
            def call(self, name, arguments):
                raise PlanningError("FORBIDDEN", "Not allowed")
        messages = [b'{invalid}\n', json.dumps({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {
            "protocolVersion": "2025-06-18", "clientInfo": {"name": "test"}}}).encode() + b"\n",
            b'{"jsonrpc":"2.0","method":"notifications/initialized"}\n',
            b'{"jsonrpc":"2.0","id":2,"method":"tools/list"}\n',
            b'{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"get_planning_context","arguments":{"tripId":"a"}}}\n',
            b'{"jsonrpc":"2.0","id":4,"method":"ping"}\n']
        sink = io.StringIO()
        McpServer(Api()).serve(io.BytesIO(b"".join(messages)), sink)
        responses = [json.loads(line) for line in sink.getvalue().splitlines()]
        self.assertEqual(responses[0]["error"]["code"], -32700)
        self.assertEqual(len(responses[2]["result"]["tools"]), 4)
        self.assertTrue(responses[3]["result"]["isError"])
        self.assertEqual(responses[3]["result"]["structuredContent"]["error"]["code"], "FORBIDDEN")
        self.assertEqual(responses[4]["result"], {})

    def test_actual_stdio_subprocess_lifecycle_without_network(self):
        env = dict(os.environ)
        env.pop("TRIPICK_API_TOKEN", None)
        env["OPENAI_API_KEY"] = "must-not-reach-mcp"
        with StdioMcpClient(env=env) as client:
            self.assertNotIn("OPENAI_API_KEY", client.env)
            self.assertEqual(client.initialize(2)["serverInfo"]["name"], "tripick-planning")
            self.assertEqual(len(client.list_tools(2)), 4)
            result = client.call_tool("get_planning_context", {"tripId": "a"}, 2)
            self.assertEqual(result["structuredContent"]["error"]["code"], "CONFIG_ERROR")

    def test_subprocess_timeout_is_bounded(self):
        with StdioMcpClient([sys.executable, "-c", "import time; time.sleep(10)"]) as client:
            started = time.monotonic()
            with self.assertRaises(PlanningError) as raised:
                client.initialize(0.05)
            self.assertEqual(raised.exception.code, "TOOL_TIMEOUT")
            self.assertLess(time.monotonic() - started, 1)


class AgentTests(unittest.TestCase):
    def test_actual_response_calls_are_executed_and_results_fed_back(self):
        mcp = FakeMcp()
        model = ScriptedModel([call("get_planning_context", {"tripId": "trip-a"}),
                               call("evaluate_itinerary", CANDIDATE_ARGS, "evaluate"),
                               call("validate_itinerary", CANDIDATE_ARGS, "validate"),
                               {"role": "assistant", "content": "Opening hours remain unknown."}])
        result = PlanningAgent(mcp, model, "trip-a", locked_item_ids=["locked"], required_item_ids=["required"]).run("Improve")
        self.assertEqual(result["status"], "completed")
        self.assertFalse(result["saved"])
        self.assertEqual([entry[0] for entry in mcp.calls], ["get_planning_context", "evaluate_itinerary", "validate_itinerary"])
        self.assertEqual(mcp.calls[0][1]["lockedItemIds"], ["locked"])
        self.assertEqual(mcp.calls[0][1]["requiredItemIds"], ["required"])
        self.assertEqual(result["candidate"]["unknownConstraints"][0]["code"], "OPENING_HOURS_UNKNOWN")
        messages, tools, _ = model.inputs[1]
        self.assertEqual(messages[-1]["role"], "tool")
        self.assertEqual(json.loads(messages[-1]["content"])["structuredContent"]["snapshotId"], "snapshot-a")
        props = tools[0]["function"]["parameters"]["properties"]
        self.assertNotIn("lockedItemIds", props)
        self.assertNotIn("requiredItemIds", props)
        self.assertEqual([e["event"] for e in result["trace"]].count("model_call"), 4)

    def test_does_not_hardcode_calls_when_model_finishes(self):
        mcp = FakeMcp()
        result = PlanningAgent(mcp, ScriptedModel([{"role": "assistant", "content": "Done"}]), "trip-a").run("Improve")
        self.assertEqual(mcp.calls, [])
        self.assertEqual(result["terminationReason"], "NO_VALIDATED_CANDIDATE")

    def test_invalid_trip_and_constraint_changes_rejected_then_model_can_repair(self):
        mcp = FakeMcp()
        model = ScriptedModel([call("get_planning_context", {"tripId": "other"}),
                               call("get_planning_context", {"tripId": "trip-a", "requiredItemIds": []}, "2"),
                               call("get_planning_context", {"tripId": "trip-a"}, "3"),
                               {"role": "assistant", "content": "Stopped"}])
        result = PlanningAgent(mcp, model, "trip-a", required_item_ids=["required"]).run("Improve")
        self.assertEqual(result["argumentRepairs"], 2)
        self.assertEqual(len(mcp.calls), 1)
        self.assertEqual(mcp.calls[0][1]["requiredItemIds"], ["required"])

    def test_snapshot_and_malformed_args_never_reach_mcp(self):
        bad_json = call("get_planning_context", {})
        bad_json["tool_calls"][0]["function"]["arguments"] = "not-json"
        model = ScriptedModel([bad_json, call("get_planning_context", {"tripId": "trip-a"}, "2"),
                               call("validate_itinerary", {**CANDIDATE_ARGS, "snapshotVersion": "other"}, "3"),
                               {"role": "assistant", "content": "Stop"}])
        mcp = FakeMcp()
        result = PlanningAgent(mcp, model, "trip-a").run("Improve")
        self.assertEqual(result["argumentRepairs"], 2)
        self.assertEqual(len(mcp.calls), 1)

    def test_tool_and_argument_budgets(self):
        mcp = FakeMcp()
        model = ScriptedModel([call("get_planning_context", {"tripId": "trip-a"}, str(i)) for i in range(12)])
        result = PlanningAgent(mcp, model, "trip-a", max_tool_calls=3).run("Improve")
        self.assertEqual(result["terminationReason"], "TOOL_CALL_LIMIT")
        self.assertEqual(len(mcp.calls), 3)
        model = ScriptedModel([call("save_itinerary", {"tripId": "trip-a"}, str(i)) for i in range(4)])
        result = PlanningAgent(FakeMcp(), model, "trip-a").run("Improve")
        self.assertEqual(result["terminationReason"], "ARGUMENT_REPAIR_LIMIT")
        self.assertEqual(result["toolCalls"], 3)

    def test_total_model_retry_budget_two(self):
        failure = PlanningError("MODEL_UNAVAILABLE", "Retry", retryable=True)
        model = ScriptedModel([failure, failure, failure])
        result = PlanningAgent(FakeMcp(), model, "trip-a").run("Improve")
        self.assertEqual(result["modelCalls"], 3)
        self.assertEqual(result["modelRetries"], 2)
        self.assertEqual(result["status"], "failed")

    def test_hard_total_deadline_bounds_noncooperative_model(self):
        class SlowModel:
            def complete(self, *_args, **_kwargs):
                time.sleep(1)
                return {"role": "assistant", "content": "late"}
        started = time.monotonic()
        result = PlanningAgent(FakeMcp(), SlowModel(), "trip-a", timeout=0.05).run("Improve")
        self.assertEqual(result["terminationReason"], "DEADLINE_EXCEEDED")
        self.assertLess(time.monotonic() - started, 0.5)

    def test_tool_timeout_returns_explicit_failure(self):
        model = ScriptedModel([call("get_planning_context", {"tripId": "trip-a"})])
        mcp = FakeMcp({"get_planning_context": PlanningError("TOOL_TIMEOUT", "slow", retryable=True)})
        result = PlanningAgent(mcp, model, "trip-a").run("Improve")
        self.assertEqual(result["terminationReason"], "TOOL_TIMEOUT")
        self.assertEqual(result["trace"][-2]["event"], "tool_failure")

    def test_constraints_removed_by_api_are_terminal(self):
        mcp = FakeMcp({"get_planning_context": tool_result(context())})
        result = PlanningAgent(mcp, ScriptedModel([call("get_planning_context", {"tripId": "trip-a"})]),
                               "trip-a", required_item_ids=["required"]).run("Improve")
        self.assertEqual(result["terminationReason"], "CONSTRAINT_MISMATCH")

    def test_malformed_tool_response_is_structured_and_can_be_reported(self):
        malformed = candidate()
        malformed["violations"] = None
        mcp = FakeMcp({"validate_itinerary": tool_result(malformed)})
        model = ScriptedModel([call("get_planning_context", {"tripId": "trip-a"}),
                               call("validate_itinerary", CANDIDATE_ARGS, "v"),
                               {"role": "assistant", "content": "The API response was invalid."}])
        result = PlanningAgent(mcp, model, "trip-a").run("Improve")
        self.assertEqual(result["terminationReason"], "NO_VALIDATED_CANDIDATE")
        self.assertTrue(any(event.get("code") == "INVALID_TOOL_RESPONSE" for event in result["trace"]))

    def test_cancellation_has_an_explicit_terminal_state(self):
        agent = PlanningAgent(FakeMcp(), ScriptedModel([]), "trip-a")
        with patch.object(agent, "_bounded", side_effect=KeyboardInterrupt):
            result = agent.run("Improve")
        self.assertEqual(result["terminationReason"], "CANCELLED")
        self.assertFalse(result["saved"])

    def test_model_adapter_parses_actual_function_message(self):
        captured = []
        message = call("get_planning_context", {"tripId": "trip-a"})
        def transport(*args):
            captured.append(args)
            return {"choices": [{"message": message}]}
        model = ChatCompletionsModel("chosen-model", "https://example.com/v1", "model-key", transport)
        self.assertEqual(model.complete([], [], 2), message)
        self.assertEqual(captured[0][0], "https://example.com/v1/chat/completions")
        self.assertEqual(captured[0][1]["model"], "chosen-model")
        self.assertEqual(captured[0][1]["tool_choice"], "auto")

    def test_verified_fallback_retained_on_tool_budget_exit(self):
        model = ScriptedModel([call("get_planning_context", {"tripId": "trip-a"}),
                               call("validate_itinerary", CANDIDATE_ARGS, "validate"),
                               call("optimize_itinerary", CANDIDATE_ARGS, "optimize")])
        result = PlanningAgent(FakeMcp(), model, "trip-a", max_tool_calls=2).run("Improve")
        self.assertEqual(result["terminationReason"], "TOOL_CALL_LIMIT")
        self.assertEqual(result["candidate"]["candidateId"], "candidate-a")

    def test_validation_must_explicitly_accept_and_have_real_items_and_no_pin_misses(self):
        invalid_results = []
        for field, values in {"valid": [False, None, 1], "normalizedItems": [None, [], {}, [{}]],
                              "candidateId": [None, 1]}.items():
            for value in values:
                rejected = candidate()
                rejected[field] = value
                invalid_results.append(rejected)
        for misses in (1, None, False):
            rejected = candidate()
            rejected["metrics"]["pinMisses"] = misses
            invalid_results.append(rejected)
        missing = candidate()
        del missing["valid"]
        invalid_results.append(missing)
        for rejected in invalid_results:
            with self.subTest(rejected=rejected):
                model = ScriptedModel([call("get_planning_context", {"tripId": "trip-a"}),
                                       call("validate_itinerary", CANDIDATE_ARGS, "v"),
                                       {"role": "assistant", "content": "Done"}])
                mcp = FakeMcp({"validate_itinerary": tool_result(rejected)})
                result = PlanningAgent(mcp, model, "trip-a").run("Improve")
                self.assertEqual(result["terminationReason"], "NO_VALIDATED_CANDIDATE")
                self.assertIsNone(result["candidate"])

    def test_optimizer_result_must_be_revalidated_before_completion(self):
        improved = candidate()
        improved["candidateId"] = "candidate-b"
        mcp = FakeMcp({"optimize_itinerary": tool_result(improved)})
        model = ScriptedModel([call("get_planning_context", {"tripId": "trip-a"}),
                               call("validate_itinerary", CANDIDATE_ARGS, "v"),
                               call("optimize_itinerary", CANDIDATE_ARGS, "o"),
                               {"role": "assistant", "content": "Done"}])
        result = PlanningAgent(mcp, model, "trip-a").run("Improve")
        self.assertEqual(result["terminationReason"], "NO_VALIDATED_CANDIDATE")
        self.assertIsNone(result["candidate"])

    def test_evaluation_identity_changes_preserve_validation_only_for_equivalent_valid_items(self):
        for change in ("same-items", "changed-items", "invalid"):
            with self.subTest(change=change):
                evaluated = candidate()
                evaluated["candidateId"] = "fresh-evaluation-uuid"
                if change == "changed-items":
                    evaluated["normalizedItems"][0]["durationMin"] += 10
                elif change == "invalid":
                    evaluated["valid"] = False
                model = ScriptedModel([call("get_planning_context", {"tripId": "trip-a"}),
                                       call("validate_itinerary", CANDIDATE_ARGS, "v"),
                                       call("evaluate_itinerary", CANDIDATE_ARGS, "e"),
                                       {"role": "assistant", "content": "Done"}])
                mcp = FakeMcp({"evaluate_itinerary": tool_result(evaluated)})
                result = PlanningAgent(mcp, model, "trip-a").run("Improve")
                if change == "same-items":
                    self.assertEqual(result["status"], "completed")
                    self.assertEqual(result["candidate"]["candidateId"], "fresh-evaluation-uuid")
                else:
                    self.assertEqual(result["terminationReason"], "NO_VALIDATED_CANDIDATE")
                    self.assertIsNone(result["candidate"])

    def test_stale_snapshot_then_deadline_never_returns_previous_fallback(self):
        stale = PlanningError("STALE_SNAPSHOT", "Snapshot changed")
        for response in (tool_result(error=stale), stale):
            with self.subTest(response=response):
                model = ScriptedModel([call("get_planning_context", {"tripId": "trip-a"}),
                                       call("validate_itinerary", CANDIDATE_ARGS, "v"),
                                       call("evaluate_itinerary", CANDIDATE_ARGS, "e"),
                                       PlanningError("DEADLINE_EXCEEDED", "Time expired")])
                mcp = FakeMcp({"evaluate_itinerary": response})
                result = PlanningAgent(mcp, model, "trip-a").run("Improve")
                self.assertEqual(result["terminationReason"], "DEADLINE_EXCEEDED")
                self.assertIsNone(result["candidate"])
                self.assertFalse(result["candidateIsFallback"])

    def test_malformed_optimizer_response_cannot_reuse_previous_validation(self):
        model = ScriptedModel([call("get_planning_context", {"tripId": "trip-a"}),
                               call("validate_itinerary", CANDIDATE_ARGS, "v"),
                               call("optimize_itinerary", CANDIDATE_ARGS, "o"),
                               {"role": "assistant", "content": "Done"}])
        mcp = FakeMcp({"optimize_itinerary": {"content": [{"type": "text", "text": "invalid-json"}]}})
        result = PlanningAgent(mcp, model, "trip-a").run("Improve")
        self.assertEqual(result["terminationReason"], "NO_VALIDATED_CANDIDATE")
        self.assertIsNone(result["candidate"])

    def test_optimizer_then_explicit_validation_can_complete(self):
        class OptimizeMcp(FakeMcp):
            def call_tool(self, name, arguments, timeout):
                result = super().call_tool(name, arguments, timeout)
                if name == "validate_itinerary" and arguments.get("candidateId") == "candidate-b":
                    improved = candidate()
                    improved["candidateId"] = "candidate-b"
                    return tool_result(improved)
                return result
        improved = candidate()
        improved["candidateId"] = "candidate-b"
        model = ScriptedModel([call("get_planning_context", {"tripId": "trip-a"}),
                               call("validate_itinerary", CANDIDATE_ARGS, "v"),
                               call("optimize_itinerary", CANDIDATE_ARGS, "o"),
                               call("validate_itinerary", {**CANDIDATE_ARGS, "candidateId": "candidate-b"}, "new-v"),
                               {"role": "assistant", "content": "Done"}])
        mcp = OptimizeMcp({"optimize_itinerary": tool_result(improved)})
        result = PlanningAgent(mcp, model, "trip-a").run("Improve")
        self.assertEqual(result["status"], "completed")
        self.assertEqual(result["candidate"]["candidateId"], "candidate-b")
        self.assertFalse(result["candidateIsFallback"])

    def test_unvalidated_optimization_can_only_return_previous_candidate_as_budget_fallback(self):
        improved = candidate()
        improved["candidateId"] = "candidate-b"
        model = ScriptedModel([call("get_planning_context", {"tripId": "trip-a"}),
                               call("validate_itinerary", CANDIDATE_ARGS, "v"),
                               call("optimize_itinerary", CANDIDATE_ARGS, "o"),
                               call("validate_itinerary", {**CANDIDATE_ARGS, "candidateId": "candidate-b"}, "new-v")])
        mcp = FakeMcp({"optimize_itinerary": tool_result(improved)})
        result = PlanningAgent(mcp, model, "trip-a", max_tool_calls=3).run("Improve")
        self.assertEqual(result["terminationReason"], "TOOL_CALL_LIMIT")
        self.assertEqual(result["status"], "incomplete")
        self.assertEqual(result["candidate"]["candidateId"], "candidate-a")
        self.assertTrue(result["candidateIsFallback"])

    def test_failed_latest_validation_cannot_complete_with_previous_valid_candidate(self):
        class SecondInvalidMcp(FakeMcp):
            def call_tool(self, name, arguments, timeout):
                result = super().call_tool(name, arguments, timeout)
                if name == "validate_itinerary" and len(self.calls) == 3:
                    rejected = candidate()
                    rejected["valid"] = False
                    return tool_result(rejected)
                return result
        model = ScriptedModel([call("get_planning_context", {"tripId": "trip-a"}),
                               call("validate_itinerary", CANDIDATE_ARGS, "v"),
                               call("validate_itinerary", CANDIDATE_ARGS, "v-again"),
                               {"role": "assistant", "content": "Done"}])
        result = PlanningAgent(SecondInvalidMcp(), model, "trip-a").run("Improve")
        self.assertEqual(result["terminationReason"], "NO_VALIDATED_CANDIDATE")
        self.assertIsNone(result["candidate"])

    def test_model_usage_prompt_hash_and_budgets_are_recorded_without_raw_secrets(self):
        replies = [call("get_planning_context", {"tripId": "trip-a"}),
                   {"role": "assistant", "content": "No candidate"}]
        def transport(*_args):
            return {"choices": [{"message": replies.pop(0)}], "model": "resolved-model",
                    "usage": {"prompt_tokens": 12, "completion_tokens": 4, "total_tokens": 16,
                              "secret": "SECRET-usage", "cached_tokens": 7}}
        model = ChatCompletionsModel("chosen-model", "https://example.com/v1", "SECRET-api-key", transport)
        result = PlanningAgent(FakeMcp(), model, "trip-a", max_tool_calls=4, timeout=3).run("PRIVATE-user-request")
        self.assertEqual(result["modelId"], "chosen-model")
        self.assertEqual(result["modelCallsWithUsage"], 2)
        self.assertEqual(result["usage"], {"prompt_tokens": 24, "completion_tokens": 8, "total_tokens": 32})
        initial = result["trace"][0]
        self.assertEqual(initial["event"], "agent_started")
        self.assertEqual(initial["config"]["maxToolCalls"], 4)
        self.assertEqual(initial["config"]["timeoutSeconds"], 3)
        self.assertEqual(len(initial["promptHash"]), 64)
        responses = [event for event in result["trace"] if event["event"] == "model_response"]
        self.assertEqual(responses[0]["modelId"], "resolved-model")
        self.assertEqual(responses[0]["usage"]["total_tokens"], 16)
        serialized_trace = json.dumps(result["trace"])
        self.assertNotIn("PRIVATE-user-request", serialized_trace)
        self.assertNotIn("SECRET-", serialized_trace)
        self.assertNotIn("trip-a", serialized_trace)


if __name__ == "__main__":
    unittest.main()
