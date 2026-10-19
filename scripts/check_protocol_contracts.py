"""Check the protocol ledger and shape-only fixtures without external dependencies."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
LEDGER = ROOT / "reference" / "protocol-ledger.md"
FIXTURE_DIR = ROOT / "tests" / "fixtures" / "protocol"
FIXTURES = (
    "login-response-shape.json",
    "classification-response-shape.json",
    "list-response-shape.json",
    "detail-response-shape.json",
    "playback-response-shape.json",
)
REQUIRED_LEDGER_TERMS = (
    "登录",
    "分类",
    "影视列表",
    "合集详情与剧集",
    "播放",
    "证据层级",
    "fixture / test",
    "未知项",
)
REQUIRED_PATHS = (
    "/key/pub",
    "/auth/login",
    "/zvideo/classification/list",
    "/zvideo/video/v2/list",
    "/zvideo/collection/v2/info",
    "/transcode/play",
    "/transcode/video/streams",
)
SENSITIVE_FIELD_NAMES = {
    "password",
    "sms_code",
    "sms_proof",
    "proof",
    "token",
    "cookie",
    "authorization",
    "uri",
    "play_addr",
    "play_url",
    "file_path",
    "encrypted_path",
}
VALUE_KEYS = {"value", "example", "examples", "sample", "raw", "raw_value"}
SENSITIVE_VALUE_RE = re.compile(
    r"(?:https?://|token=|password=|cookie:|authorization:|splay/|sms[_-]?code)",
    re.IGNORECASE,
)


def fail(errors: list[str], message: str) -> None:
    errors.append(message)


def check_fixture(path: Path, errors: list[str]) -> None:
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        fail(errors, f"{path.relative_to(ROOT)}: invalid JSON: {error}")
        return

    if document.get("fixture_version") != 1:
        fail(errors, f"{path.name}: fixture_version must be 1")
    if not isinstance(document.get("endpoints"), list) or not document["endpoints"]:
        fail(errors, f"{path.name}: endpoints must be a non-empty list")
    if not isinstance(document.get("variants"), dict) or not document["variants"]:
        fail(errors, f"{path.name}: variants must be a non-empty object")

    safety = document.get("safety")
    if not isinstance(safety, dict):
        fail(errors, f"{path.name}: safety policy is missing")
    else:
        if safety.get("values_omitted") is not True:
            fail(errors, f"{path.name}: safety.values_omitted must be true")
        if safety.get("raw_payload_included") is not False:
            fail(errors, f"{path.name}: safety.raw_payload_included must be false")

    for endpoint in document.get("endpoints", []):
        if not isinstance(endpoint, dict):
            fail(errors, f"{path.name}: endpoint must be an object")
            continue
        if endpoint.get("method") not in {"GET", "POST"}:
            fail(errors, f"{path.name}: endpoint method is invalid")
        endpoint_path = endpoint.get("path")
        if not isinstance(endpoint_path, str) or not endpoint_path.startswith("/"):
            fail(errors, f"{path.name}: endpoint path must be an absolute API path")

    for variant_name, variant in document.get("variants", {}).items():
        if not isinstance(variant, dict):
            fail(errors, f"{path.name}:{variant_name}: variant must be an object")
            continue
        if not isinstance(variant.get("http_status_type"), str):
            fail(errors, f"{path.name}:{variant_name}: http_status_type is missing")
        if not isinstance(variant.get("code_types"), list) or not variant["code_types"]:
            fail(errors, f"{path.name}:{variant_name}: code_types is missing")
        inspect_shape_fields(path, variant.get("data"), errors, f"{variant_name}.data")

    scan_strings(document, path, errors)


def inspect_shape_fields(path: Path, node: Any, errors: list[str], location: str) -> None:
    if not isinstance(node, dict):
        return
    for field_group in ("fields", "item_fields", "episode_fields"):
        fields = node.get(field_group)
        if fields is None:
            continue
        if not isinstance(fields, dict):
            fail(errors, f"{path.name}:{location}.{field_group}: must be an object")
            continue
        for field_name, descriptor in fields.items():
            if not isinstance(descriptor, dict):
                fail(errors, f"{path.name}:{location}.{field_group}.{field_name}: descriptor is invalid")
                continue
            if not isinstance(descriptor.get("types"), list) or not descriptor["types"]:
                fail(errors, f"{path.name}:{location}.{field_group}.{field_name}: types are missing")
            if descriptor.get("value_omitted") is not True:
                fail(errors, f"{path.name}:{location}.{field_group}.{field_name}: value_omitted must be true")
            if field_name.lower() in SENSITIVE_FIELD_NAMES and VALUE_KEYS.intersection(descriptor):
                fail(errors, f"{path.name}:{location}.{field_group}.{field_name}: sensitive value-like key is forbidden")


def scan_strings(node: Any, path: Path, errors: list[str]) -> None:
    if isinstance(node, dict):
        for value in node.values():
            scan_strings(value, path, errors)
    elif isinstance(node, list):
        for value in node:
            scan_strings(value, path, errors)
    elif isinstance(node, str) and SENSITIVE_VALUE_RE.search(node):
        fail(errors, f"{path.name}: suspicious sensitive value pattern: {node!r}")


def main() -> int:
    errors: list[str] = []
    if not LEDGER.is_file():
        fail(errors, "reference/protocol-ledger.md is missing")
    else:
        text = LEDGER.read_text(encoding="utf-8")
        for term in REQUIRED_LEDGER_TERMS:
            if term not in text:
                fail(errors, f"protocol ledger is missing required term: {term}")
        for endpoint_path in REQUIRED_PATHS:
            if endpoint_path not in text:
                fail(errors, f"protocol ledger is missing endpoint path: {endpoint_path}")

    for fixture_name in FIXTURES:
        fixture_path = FIXTURE_DIR / fixture_name
        if not fixture_path.is_file():
            fail(errors, f"missing fixture: tests/fixtures/protocol/{fixture_name}")
        else:
            check_fixture(fixture_path, errors)

    if errors:
        for error in errors:
            print(f"FAIL: {error}")
        return 1

    print(f"PASS: protocol ledger and {len(FIXTURES)} shape-only fixtures are structurally safe")
    print("NOTE: this check does not prove a real NAS protocol or playback path")
    return 0


if __name__ == "__main__":
    sys.exit(main())
