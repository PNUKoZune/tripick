"""Shared strict tool contracts; no auth material is part of a tool input."""

import math


class PlanningError(Exception):
    def __init__(self, code, message, *, retryable=False, details=None):
        super().__init__(message)
        self.code, self.message = code, message
        self.retryable, self.details = retryable, details or {}

    def as_dict(self):
        return {"code": self.code, "message": self.message,
                "retryable": self.retryable, "details": self.details}


def obj(properties, required=()):
    return {"type": "object", "properties": properties, "required": list(required),
            "additionalProperties": False}


ID = {"type": "string", "minLength": 1, "maxLength": 256}
IDS = {"type": "array", "items": ID, "maxItems": 500, "uniqueItems": True}
TEXT = {"type": "string", "maxLength": 2000}
ITEM = obj({
    "id": ID, "tripId": ID, "day": {"type": "integer", "minimum": 1, "maximum": 365},
    "order": {"type": "integer", "minimum": 0, "maximum": 10000},
    "type": {"type": "string", "enum": ["attraction", "restaurant", "cafe", "accommodation", "transport"]},
    "name": TEXT, "address": TEXT,
    "coordinates": obj({"lat": {"type": "number", "minimum": -90, "maximum": 90},
                        "lng": {"type": "number", "minimum": -180, "maximum": 180}}, ("lat", "lng")),
    "scheduledAt": {"type": "string", "minLength": 1, "maxLength": 64},
    "durationMin": {"type": "number", "minimum": 0, "maximum": 1440},
    "travelTimeMin": {"type": "number", "minimum": 0, "maximum": 10080},
    **{key: TEXT for key in ("openingHours", "phoneNumber", "kakaoPlaceId", "imageUrl", "memo")},
}, ("id", "day", "order", "scheduledAt", "durationMin"))

CONTEXT_SCHEMA = obj({"tripId": ID, "lockedItemIds": IDS, "requiredItemIds": IDS,
                      "refreshCandidates": {"type": "boolean"}}, ("tripId",))
CANDIDATE_PROPERTIES = {
    "tripId": ID, "snapshotId": ID,
    "snapshotVersion": {"type": "string", "minLength": 1, "maxLength": 256},
    "candidateId": ID,
    "items": {"type": "array", "items": ITEM, "maxItems": 500},
}
CANDIDATE_SCHEMA = obj(CANDIDATE_PROPERTIES, ("tripId", "snapshotId", "snapshotVersion"))
OPTIMIZE_SCHEMA = obj({**CANDIDATE_PROPERTIES,
                       "maxEvaluations": {"type": "integer", "minimum": 1, "maximum": 50},
                       "timeBudgetMs": {"type": "integer", "minimum": 1, "maximum": 2000}},
                      ("tripId", "snapshotId", "snapshotVersion"))
TOOL_SCHEMAS = {"get_planning_context": CONTEXT_SCHEMA,
                "validate_itinerary": CANDIDATE_SCHEMA,
                "evaluate_itinerary": CANDIDATE_SCHEMA,
                "optimize_itinerary": OPTIMIZE_SCHEMA}
DESCRIPTIONS = {
    "get_planning_context": "Create an owned trip planning snapshot. Preserve user locks and required items. Draft only.",
    "validate_itinerary": "Normalize a copied candidate and report violations and unknown constraints. Does not save.",
    "evaluate_itinerary": "Evaluate a snapshot candidate with server metrics. Does not save.",
    "optimize_itinerary": "Run bounded local search (at most 50 evaluations / 2 seconds). Return an unsaved draft.",
}


def validate(value, schema, path="arguments"):
    """Small, deliberately closed validator for only the JSON Schema features above."""
    kind = schema.get("type")
    kinds = kind if isinstance(kind, list) else [kind]
    matches = {"object": isinstance(value, dict), "array": isinstance(value, list),
               "string": isinstance(value, str), "boolean": isinstance(value, bool),
               "integer": isinstance(value, int) and not isinstance(value, bool),
               "number": isinstance(value, (int, float)) and not isinstance(value, bool)}
    if not any(matches.get(t, False) for t in kinds):
        raise PlanningError("INVALID_ARGUMENTS", f"{path} has an invalid type")
    if "enum" in schema and value not in schema["enum"]:
        raise PlanningError("INVALID_ARGUMENTS", f"{path} is not an allowed value")
    if isinstance(value, dict):
        unknown = set(value) - set(schema["properties"])
        if unknown:
            raise PlanningError("INVALID_ARGUMENTS", f"{path} contains unsupported fields")
        if any(key not in value for key in schema.get("required", [])):
            raise PlanningError("INVALID_ARGUMENTS", f"{path} is missing a required field")
        for key, child in value.items():
            validate(child, schema["properties"][key], f"{path}.{key}")
    elif isinstance(value, list):
        if len(value) > schema.get("maxItems", 1000000):
            raise PlanningError("INVALID_ARGUMENTS", f"{path} contains too many items")
        for index, child in enumerate(value):
            validate(child, schema["items"], f"{path}[{index}]")
        if schema.get("uniqueItems") and len(set(value)) != len(value):
            raise PlanningError("INVALID_ARGUMENTS", f"{path} contains duplicate items")
    elif isinstance(value, str):
        if not schema.get("minLength", 0) <= len(value) <= schema.get("maxLength", 1000000):
            raise PlanningError("INVALID_ARGUMENTS", f"{path} has an invalid length")
    elif isinstance(value, (float, int)) and not isinstance(value, bool):
        if not math.isfinite(value) or not schema.get("minimum", -math.inf) <= value <= schema.get("maximum", math.inf):
            raise PlanningError("INVALID_ARGUMENTS", f"{path} is outside the allowed range")


def tool_result(value=None, error=None):
    import json
    data = {"error": error.as_dict()} if error else value
    return {"content": [{"type": "text", "text": json.dumps(data, ensure_ascii=False, allow_nan=False)}],
            "structuredContent": data, "isError": error is not None}


def tool_definitions():
    import copy
    return [{"name": name, "description": DESCRIPTIONS[name], "inputSchema": copy.deepcopy(schema),
             "annotations": {"readOnlyHint": True, "destructiveHint": False, "openWorldHint": False}}
            for name, schema in TOOL_SCHEMAS.items()]
