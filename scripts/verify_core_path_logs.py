#!/usr/bin/env python3
"""Verify the structure and coverage of one z-video diagnostics JSONL log.

This is a log-evidence checker, not a NAS client and not a real-NAS acceptance
test. It never creates a success receipt. A zero exit status means only that
the selected log contains a complete, redacted-looking core-path record with
the required observable fields.
"""

from __future__ import annotations

import argparse
import json
import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable


CORE_NAS_OPERATIONS = (
    "auth.login",
    "library.classifications",
    "library.collections",
    "library.collection_detail",
    "playback.stream",
    "playback.progress",
)

CORE_UI_OPERATIONS = (
    "auth.login",
    "library.refresh",
    "library.collection_detail",
    "playback.start",
)

REQUEST_FIELDS = ("method", "path", "parse_result", "business_result")
SENSITIVE_KEYS = {
    "password",
    "sms_code",
    "sms_proof",
    "proof",
    "token",
    "cookie",
    "authorization",
    "file_path",
    "encrypted_path",
    "media_path",
    "uri",
    "play_url",
    "play_addr",
}
PRIVATE_MEDIA_RE = re.compile(
    r"(?i)(/splay/|\\splay\\|\.(?:mkv|mp4|avi|ts)(?:[?#]|$))"
)
SECRET_ASSIGNMENT_RE = re.compile(
    r"(?i)\b(?:token|password|sms_code|sms_proof|authorization|cookie)\s*[:=]"
)
URL_RE = re.compile(r"(?i)\b(?:https?|rtsp|file)://")


@dataclass(frozen=True)
class Event:
    line_number: int
    value: dict[str, Any]

    @property
    def event_type(self) -> str:
        return str(self.value.get("event_type", ""))

    @property
    def operation(self) -> str:
        return str(self.value.get("operation", ""))

    @property
    def phase(self) -> str:
        return str(self.value.get("phase", ""))

    @property
    def result(self) -> str:
        return str(self.value.get("result", ""))

    @property
    def details(self) -> dict[str, Any]:
        details = self.value.get("details", {})
        return details if isinstance(details, dict) else {}


@dataclass(frozen=True)
class Check:
    label: str
    status: str
    detail: str
    line_number: int | None = None


def default_log_path() -> Path:
    override = os.environ.get("Z_VIDEO_LOG_DIR")
    if override:
        return Path(override) / "diagnostics.jsonl"
    local_app_data = os.environ.get("LOCALAPPDATA")
    if local_app_data:
        return Path(local_app_data) / "z-video" / "logs" / "diagnostics.jsonl"
    return Path.home() / ".local" / "share" / "z-video" / "logs" / "diagnostics.jsonl"


def load_events(path: Path) -> tuple[list[Event], list[Check], list[Check]]:
    events: list[Event] = []
    structural: list[Check] = []
    privacy: list[Check] = []

    try:
        lines = path.read_text(encoding="utf-8-sig").splitlines()
    except OSError as error:
        structural.append(Check("log file", "FAIL", f"无法读取: {error}"))
        return events, structural, privacy

    for line_number, raw_line in enumerate(lines, start=1):
        if not raw_line.strip():
            continue
        try:
            value = json.loads(raw_line)
        except json.JSONDecodeError as error:
            structural.append(
                Check("JSONL", "FAIL", f"第 {line_number} 行不可解析: {error.msg}", line_number)
            )
            continue
        if not isinstance(value, dict):
            structural.append(Check("JSONL", "FAIL", "记录不是 JSON 对象", line_number))
            continue

        event = Event(line_number, value)
        events.append(event)
        scan_sensitive(value, f"第 {line_number} 行", privacy)

    if not events and not structural:
        structural.append(Check("JSONL", "FAIL", "日志没有有效记录"))
    return events, structural, privacy


def validate_event(event: Event, checks: list[Check]) -> None:
    required = ("timestamp_utc", "event_type", "operation", "phase", "result", "duration_ms")
    missing = [field for field in required if field not in event.value]
    if missing:
        checks.append(
            Check(
                "event shape",
                "FAIL",
                f"缺少字段: {', '.join(missing)}",
                event.line_number,
            )
        )
    duration = event.value.get("duration_ms")
    if not isinstance(duration, (int, float)) or isinstance(duration, bool) or duration < 0:
        checks.append(Check("duration_ms", "FAIL", "必须是非负数字", event.line_number))

    if event.event_type != "nas.request" or event.operation not in CORE_NAS_OPERATIONS:
        return
    if event.phase != "complete":
        return
    details = event.details
    missing_request_fields = [field for field in REQUEST_FIELDS if field not in details]
    if event.result != "not_sent" and missing_request_fields:
        checks.append(
            Check(
                event.operation,
                "FAIL",
                f"请求记录缺少字段: {', '.join(missing_request_fields)}",
                event.line_number,
            )
        )
    if event.result != "not_sent" and details.get("request_observed") is not True:
        checks.append(
            Check(
                event.operation,
                "FAIL",
                "缺少 request_observed=true，不能证明已到达请求边界",
                event.line_number,
            )
        )
    status = details.get("http_status")
    if status is not None and (
        not isinstance(status, int) or isinstance(status, bool) or not 100 <= status <= 599
    ):
        checks.append(Check(event.operation, "FAIL", "http_status 类型或范围错误", event.line_number))
    if event.result == "success" and status is None:
        checks.append(Check(event.operation, "FAIL", "成功请求缺少 http_status", event.line_number))


def scan_sensitive(value: Any, location: str, checks: list[Check]) -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            key_lower = str(key).lower()
            if key_lower in SENSITIVE_KEYS:
                checks.append(Check("redaction", "FAIL", f"{location} 包含禁止字段 {key}"))
            scan_sensitive(child, f"{location}.{key}", checks)
        return
    if isinstance(value, list):
        for index, child in enumerate(value):
            scan_sensitive(child, f"{location}[{index}]", checks)
        return
    if not isinstance(value, str):
        return
    if PRIVATE_MEDIA_RE.search(value):
        checks.append(Check("redaction", "FAIL", f"{location} 包含私密媒体路径"))
    if SECRET_ASSIGNMENT_RE.search(value):
        checks.append(Check("redaction", "FAIL", f"{location} 包含敏感值赋值形式"))
    if URL_RE.search(value):
        checks.append(Check("redaction", "FAIL", f"{location} 包含完整 URL"))


def latest_run(events: list[Event]) -> tuple[list[Event], str]:
    starts = [
        index
        for index, event in enumerate(events)
        if event.event_type == "app"
        and event.operation == "startup"
        and event.phase == "start"
    ]
    if not starts:
        return events, "未找到 app.startup，使用整个日志文件"
    start = starts[-1]
    return events[start:], f"第 {events[start].line_number} 行 app.startup 之后"


def latest_complete(events: Iterable[Event], event_type: str, operation: str) -> Event | None:
    matches = [
        event
        for event in events
        if event.event_type == event_type
        and event.operation == operation
        and event.phase == "complete"
    ]
    return matches[-1] if matches else None


def request_events(events: list[Event], operation: str) -> list[tuple[int, Event]]:
    return [
        (index, event)
        for index, event in enumerate(events)
        if event.event_type == "nas.request"
        and event.operation == operation
        and event.phase == "complete"
        and event.result in {"success", "error", "not_sent"}
    ]


def list_shape_before(
    events: list[Event], request_index: int, previous_request_index: int | None
) -> Event | None:
    shapes = [
        event
        for index, event in enumerate(events)
        if event.event_type == "nas.response"
        and event.operation == "library.collections.shape"
        and event.phase == "complete"
        and (previous_request_index is None or index > previous_request_index)
        and index < request_index
    ]
    return shapes[-1] if shapes else None


def classify_request(events: list[Event], operation: str) -> Check:
    attempts = request_events(events, operation)
    if not attempts:
        return Check(operation, "NOT_OBSERVED", "没有找到请求边界记录")

    request_index, event = attempts[-1]
    details = event.details
    line = event.line_number
    if event.result == "not_sent":
        return Check(operation, "NOT_SENT", f"请求未发出: {details.get('reason', '未说明')}", line)

    status = details.get("http_status")
    error_class = details.get("error_class")
    code = details.get("error_code")
    if event.result == "success":
        if operation == "library.collections":
            previous_index = attempts[-2][0] if len(attempts) > 1 else None
            shape = list_shape_before(events, request_index, previous_index)
            if shape is None:
                return Check(operation, "FAIL", "成功请求缺少列表响应 shape 记录", line)
            item_count = shape.details.get("item_count")
            if item_count == 0:
                return Check(operation, "EMPTY", "请求成功但列表为空", shape.line_number)
            if not isinstance(item_count, int) or item_count < 0:
                return Check(operation, "FAIL", "列表 item_count 无效", shape.line_number)
        return Check(
            operation,
            "PASS",
            f"HTTP {status}, parse={details.get('parse_result')}, business={details.get('business_result')}, duration_ms={event.value.get('duration_ms')}",
            line,
        )

    if error_class == "parse":
        return Check(operation, "PARSE_FAILED", f"响应解析失败, HTTP {status}", line)
    if status == 200 and (details.get("business_result") == "error" or code):
        suffix = f", code={code}" if code else ""
        return Check(operation, "BUSINESS_FAILED", f"HTTP 200 但业务失败{suffix}", line)
    if isinstance(status, int) and not 200 <= status < 300:
        return Check(operation, "HTTP_FAILED", f"HTTP {status}", line)
    if status is None:
        return Check(operation, "TRANSPORT_FAILED", f"未收到 HTTP 状态, error_class={error_class}", line)
    return Check(operation, "FAILED", f"result={event.result}", line)


def check_ui(events: list[Event], operation: str) -> Check:
    event = latest_complete(events, "ui", operation)
    if event is None:
        return Check(f"ui.{operation}", "NOT_OBSERVED", "没有完成事件")
    if event.result != "success":
        return Check(f"ui.{operation}", "FAILED", f"result={event.result}", event.line_number)
    return Check(
        f"ui.{operation}",
        "PASS",
        f"duration_ms={event.value.get('duration_ms')}",
        event.line_number,
    )


def run_checks(events: list[Event]) -> list[Check]:
    checks: list[Check] = []
    auth_ui = check_ui(events, "auth.login")
    restore_ui = latest_complete(events, "session", "session.restore")
    if auth_ui.status == "PASS":
        checks.append(auth_ui)
    elif restore_ui is not None and restore_ui.result == "success":
        checks.append(
            Check(
                "ui.auth.login/session.restore",
                "PASS",
                "本次运行通过保存会话恢复，未重新请求登录",
                restore_ui.line_number,
            )
        )
    else:
        checks.append(auth_ui)

    checks.extend(check_ui(events, operation) for operation in CORE_UI_OPERATIONS[1:])
    nas_auth = classify_request(events, "auth.login")
    if (
        nas_auth.status == "NOT_OBSERVED"
        and restore_ui is not None
        and restore_ui.result == "success"
    ):
        checks.append(
            Check(
                "nas.auth.login/session.restore",
                "PASS",
                "本次运行使用已保存会话，未重新请求登录",
                restore_ui.line_number,
            )
        )
    else:
        checks.append(nas_auth)
    checks.extend(
        classify_request(events, operation) for operation in CORE_NAS_OPERATIONS[1:]
    )
    return checks


def print_checks(checks: Iterable[Check]) -> None:
    for check in checks:
        location = f" line={check.line_number}" if check.line_number else ""
        print(f"[{check.status}] {check.label}: {check.detail}{location}")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--log",
        type=Path,
        default=None,
        help="diagnostics.jsonl 路径；默认使用 Z_VIDEO_LOG_DIR 或 LOCALAPPDATA",
    )
    parser.add_argument(
        "--all-events",
        action="store_true",
        help="不限制到最后一次 app.startup，检查整个日志文件",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    path = args.log or default_log_path()
    events, structural, privacy = load_events(path)
    scoped_events, scope_description = (
        (events, "整个日志文件") if args.all_events else latest_run(events)
    )
    scoped_structural = list(structural)
    for event in scoped_events:
        validate_event(event, scoped_structural)

    print(f"log={path}")
    print(f"scope={scope_description}; events={len(scoped_events)}")
    print("evidence_only=true; real_nas_acceptance=false")
    print_checks(scoped_structural)
    print_checks(privacy)
    runtime_checks = run_checks(scoped_events) if events else []
    print_checks(runtime_checks)

    all_checks = [*scoped_structural, *privacy, *runtime_checks]
    failed_statuses = {
        "FAIL",
        "FAILED",
        "NOT_OBSERVED",
        "NOT_SENT",
        "HTTP_FAILED",
        "BUSINESS_FAILED",
        "PARSE_FAILED",
        "TRANSPORT_FAILED",
        "EMPTY",
    }
    passed = bool(events) and not any(check.status in failed_statuses for check in all_checks)
    print("result=" + ("PASS" if passed else "INCOMPLETE"))
    if not passed:
        print("说明：检查器只证明日志结构、脱敏和事件覆盖，不能伪造或替代真实 NAS 真机验收。")
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
