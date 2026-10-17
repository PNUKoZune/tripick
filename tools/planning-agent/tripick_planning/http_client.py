"""Allowlisted authenticated Nest API calls and bounded JSON HTTP transport."""

import json
import os
import socket
import urllib.error
import urllib.parse
import urllib.request

from .contracts import PlanningError, TOOL_SCHEMAS, validate

MAX_RESPONSE_BYTES = 4 * 1024 * 1024


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def checked_base_url(value):
    parsed = urllib.parse.urlsplit(value)
    try:
        port = parsed.port
    except ValueError as exc:
        raise PlanningError("CONFIG_ERROR", "Invalid API URL port") from exc
    if (parsed.scheme not in ("https", "http") or not parsed.hostname or parsed.username
            or parsed.password or parsed.query or parsed.fragment or port == 0):
        raise PlanningError("CONFIG_ERROR", "API URL must be an http(s) origin with an optional base path")
    if parsed.scheme == "http" and parsed.hostname not in ("localhost", "127.0.0.1", "::1"):
        raise PlanningError("CONFIG_ERROR", "Remote API URLs require HTTPS")
    return value.rstrip("/")


def json_post(url, payload, token, timeout, opener=None):
    if timeout <= 0:
        raise PlanningError("DEADLINE_EXCEEDED", "Request deadline exceeded")
    request = urllib.request.Request(url, data=json.dumps(payload, allow_nan=False).encode("utf-8"),
                                     headers={"Content-Type": "application/json", "Accept": "application/json",
                                              "Authorization": f"Bearer {token}"}, method="POST")
    opener = opener or urllib.request.build_opener(NoRedirect())
    try:
        with opener.open(request, timeout=timeout) as response:
            raw = response.read(MAX_RESPONSE_BYTES + 1)
            if len(raw) > MAX_RESPONSE_BYTES:
                raise PlanningError("RESPONSE_TOO_LARGE", "API response exceeded the size limit")
            result = json.loads(raw, parse_constant=lambda _: (_ for _ in ()).throw(ValueError()))
            if not isinstance(result, dict):
                raise ValueError("Expected a JSON object")
            return result
    except urllib.error.HTTPError as exc:
        code = {401: "UNAUTHENTICATED", 403: "FORBIDDEN", 404: "NOT_FOUND", 409: "STALE_SNAPSHOT",
                429: "RATE_LIMITED"}.get(exc.code, "API_ERROR")
        raise PlanningError(code, "API rejected the request", retryable=exc.code in (429, 502, 503, 504),
                            details={"httpStatus": exc.code}) from None
    except (socket.timeout, TimeoutError):
        raise PlanningError("TOOL_TIMEOUT", "API request timed out", retryable=True) from None
    except urllib.error.URLError as exc:
        code = "TOOL_TIMEOUT" if isinstance(exc.reason, (socket.timeout, TimeoutError)) else "API_UNAVAILABLE"
        raise PlanningError(code, "API request could not complete", retryable=True) from None
    except (ValueError, UnicodeError):
        raise PlanningError("INVALID_API_RESPONSE", "API did not return a valid JSON object") from None


class PlanningApi:
    OPERATIONS = {"get_planning_context": "context", "validate_itinerary": "validate",
                  "evaluate_itinerary": "evaluate", "optimize_itinerary": "optimize"}

    def __init__(self, base_url=None, token=None, timeout=10.0, transport=json_post):
        self.base_url = checked_base_url(base_url or os.environ.get("TRIPICK_API_URL", "http://localhost:4000/api/v1"))
        self.token = token if token is not None else os.environ.get("TRIPICK_API_TOKEN", "")
        if not self.token or any(c in self.token for c in "\r\n"):
            raise PlanningError("CONFIG_ERROR", "Set TRIPICK_API_TOKEN to an authenticated user's JWT")
        self.timeout, self.transport = min(float(timeout), 30.0), transport
        if self.timeout <= 0:
            raise PlanningError("CONFIG_ERROR", "API timeout must be positive")

    def call(self, name, arguments, timeout=None):
        if name not in self.OPERATIONS:
            raise PlanningError("UNKNOWN_TOOL", "Tool is not allowed")
        validate(arguments, TOOL_SCHEMAS[name])
        trip_id = arguments["tripId"]
        if any(item.get("tripId", trip_id) != trip_id for item in arguments.get("items", [])):
            raise PlanningError("TRIP_MISMATCH", "Every itinerary item must belong to the requested trip")
        encoded_trip = urllib.parse.quote(trip_id, safe="")
        if trip_id in (".", ".."):
            raise PlanningError("INVALID_ARGUMENTS", "Trip identifier is invalid")
        path = f"/trips/{encoded_trip}/planning/{self.OPERATIONS[name]}"
        body = {key: value for key, value in arguments.items() if key != "tripId"}
        return self.transport(self.base_url + path, body, self.token,
                              min(self.timeout, timeout) if timeout is not None else self.timeout)
