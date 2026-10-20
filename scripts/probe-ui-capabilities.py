"""Read-only NAS capability probe; credentials and media values stay in memory."""
import ctypes
from ctypes import wintypes
import datetime
import ipaddress
import json
from pathlib import Path
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request


READ_PATHS = {
    "/zvideo/classification/list", "/zvideo/video/v2/list",
    "/zvideo/search/index", "/zvideo/search/suggest",
    "/zvideo/collection/person", "/zvideo/person/collection/list",
    "/zvideo/collection/filter/v2", "/zvideo/favorite/list",
    "/zvideo/video/v2/lately", "/zvideo/video/v2/playlist",
    "/zvideo/collection/info", "/zvideo/collection/v2/info",
}
FIELDS = set("""code success data list count collection_count collection video person
    id name title file_name cover profile collection_id classification_id video_id
    person_id person_name type is_system is_enable actor director writer history
    last_video_id play_duration audio_index subtitle_index subtitle_hash subtitle_setting
    play_chapter release_year created_at score rating seen is_seen is_fav genres year
    regions resolution hdr audio collection_tag collection_type system add_task
    video_list version_list file_path duration episode episode_count extend_type
    storyline background results total page total_pages field sort number serial
    serial_number code_number dvd_id product_id jav_id av_id identifier""".split())


def shape(value, depth=0):
    if isinstance(value, dict):
        if depth >= 5:
            return {"type": "object", "field_count": len(value)}
        return {"type": "object", "fields": {
            key: shape(item, depth + 1) for key, item in value.items() if key in FIELDS
        }, "other_field_count": sum(key not in FIELDS for key in value)}
    if isinstance(value, list):
        return {"type": "array", "length": len(value),
                "sample_shapes": [shape(item, depth + 1) for item in value[:2]]
                if depth < 5 else []}
    return {"type": "null" if value is None else
            "boolean" if isinstance(value, bool) else
            "number" if isinstance(value, (int, float)) else "string"}


def saved_session():
    class Credential(ctypes.Structure):
        _fields_ = [("Flags", wintypes.DWORD), ("Type", wintypes.DWORD),
                    ("TargetName", wintypes.LPWSTR), ("Comment", wintypes.LPWSTR),
                    ("LastWritten", wintypes.FILETIME),
                    ("CredentialBlobSize", wintypes.DWORD),
                    ("CredentialBlob", ctypes.POINTER(ctypes.c_ubyte)),
                    ("Persist", wintypes.DWORD), ("AttributeCount", wintypes.DWORD),
                    ("Attributes", ctypes.c_void_p), ("TargetAlias", wintypes.LPWSTR),
                    ("UserName", wintypes.LPWSTR)]
    api = ctypes.WinDLL("Advapi32.dll", use_last_error=True)
    api.CredReadW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD,
                             ctypes.POINTER(ctypes.POINTER(Credential))]
    api.CredReadW.restype = wintypes.BOOL
    api.CredFree.argtypes = [ctypes.c_void_p]
    pointer = ctypes.POINTER(Credential)()
    if not api.CredReadW("default_user.z-video", 1, 0, ctypes.byref(pointer)):
        code = ctypes.get_last_error()
        return None, "missing" if code == 1168 else "unavailable_win32_" + str(code)
    try:
        item = pointer.contents
        return json.loads(ctypes.string_at(item.CredentialBlob,
                                           item.CredentialBlobSize).decode("utf-16-le")), "loaded"
    finally:
        api.CredFree(pointer)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def items(data):
    return data if isinstance(data, list) else data.get("list", []) if isinstance(data, dict) else []


def main():
    # Check that sensitive values and unknown dictionary keys cannot enter evidence.
    sentinel = "PRIVATE_SENTINEL"
    assert sentinel not in json.dumps(shape({"title": sentinel, sentinel: sentinel,
                                           "history": {"subtitle_hash": sentinel}}))
    root = Path(__file__).resolve().parents[1]
    output = root / "reference/reverse-engineering/ui-runtime-probe-2026-10-19.json"
    history_only = "--history-only" in sys.argv
    report = json.loads(output.read_text(encoding="utf-8")) if history_only else {
              "observed_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
              "scope": "read-only; no playback, progress, favorites or credential writes",
              "requests": []}
    credentials, state = saved_session()
    report["credential_state"] = state
    if not credentials or not credentials.get("token"):
        report["result"] = "blocked_credential_unavailable" if state.startswith("unavailable") else "blocked_no_saved_session"
        output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        print(json.dumps(report))
        return
    base = credentials["server_url"].strip().rstrip("/")
    if "://" not in base:
        base = "http://" + base
    parsed = urllib.parse.urlsplit(base)
    address = ipaddress.ip_address(parsed.hostname)
    if not address.is_private or parsed.username or parsed.password or parsed.scheme not in ("http", "https"):
        raise ValueError("unsupported_target")
    if parsed.port is None:
        base = urllib.parse.urlunsplit((parsed.scheme, parsed.netloc + ":5055", "", "", ""))
    context = {"token": credentials["token"], "app": "video", "plat": "pc"}
    if credentials.get("nas_id"):
        context["nasid"] = credentials["nas_id"]
    cookie = {"token": credentials["token"], "app": "video", "plat": "pc"}
    for source, target in (("nas_id", "nas_id"), ("nas_sign", "sign")):
        if credentials.get(source):
            cookie[target] = credentials[source]
    headers = {"token": credentials["token"], "Cookie": "; ".join(
        key + "=" + urllib.parse.quote(str(value), safe="") for key, value in cookie.items()),
        "Content-Type": "application/x-www-form-urlencoded"}
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())

    def request(path, form=None, label=None):
        if path not in READ_PATHS or len(report["requests"]) >= 20:
            raise ValueError("request_not_allowed")
        entry = {"path": path, "label": label or path, "method": "POST",
                 "parameter_keys": sorted((form or {}).keys())}
        report["requests"].append(entry)
        started = time.perf_counter()
        try:
            payload = urllib.parse.urlencode({**context, **(form or {})}).encode()
            req = urllib.request.Request(base + path + "?drnd=" + str(time.time_ns()),
                                         data=payload, headers=headers, method="POST")
            with opener.open(req, timeout=12) as response:
                entry["http_status"] = response.status
                raw = response.read(8 * 1024 * 1024 + 1)
            if len(raw) > 8 * 1024 * 1024:
                entry["error"] = "response_limit"
                return None
            body = json.loads(raw)
            if not isinstance(body, dict):
                entry["error"] = "unexpected_envelope"
                return None
            code = str(body.get("code", ""))
            entry["business_code"] = code if re.fullmatch(r"(?:\d{1,6}|[A-Z]\d{3,10})", code) else "other"
            entry["business_success"] = code in ("200", "S000200")
            entry["response_shape"] = shape(body)
            if not entry["business_success"]:
                return None
            return body.get("data")
        except urllib.error.HTTPError as error:
            entry["http_status"] = error.code
            entry["error"] = "http"
            return None
        except Exception as error:
            entry["error"] = type(error).__name__
            return None
        finally:
            entry["elapsed_ms"] = round((time.perf_counter() - started) * 1000)

    if history_only:
        history = request("/zvideo/video/v2/playlist", {"start": 1, "limit": 5}, "additional_history_samples")
        samples = []
        for watched in items(history)[1:5]:
            if not watched.get("collection_id") or not watched.get("classification_id"):
                continue
            detail = request("/zvideo/collection/info", {
                "collection_id": watched["collection_id"],
                "classification_id": watched["classification_id"], "get_type": "all"}, "additional_history_read")
            record = detail.get("history") if isinstance(detail, dict) else None
            position = record.get("play_duration") if isinstance(record, dict) else None
            try:
                numeric_position = float(position)
                position_kind = "positive" if numeric_position > 0 else "zero" if numeric_position == 0 else "negative"
            except (ValueError, TypeError):
                position_kind = "missing_or_non_numeric"
            samples.append({"history_present": isinstance(record, dict),
                            "has_video_id": bool(record.get("last_video_id")) if isinstance(record, dict) else False,
                            "position_kind": position_kind})
            if position_kind == "positive":
                break
        report["history_follow_up"] = {"observed_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                                       "samples": samples}
        output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        print(json.dumps(report["history_follow_up"]))
        return

    categories = request("/zvideo/classification/list")
    if not isinstance(categories, list) or not categories:
        report["result"] = "blocked_classifications"
    else:
        candidates = [item for item in categories if isinstance(item, dict) and
                      (item.get("is_system") != 1 or item.get("is_enable") == 1)]
        collections = []
        category_id = None
        for category in candidates[:3]:
            category_id = category.get("id")
            page = request("/zvideo/video/v2/list", {"classification_id": category_id,
                           "system": 94, "start": 1, "limit": 5}, "sample_library")
            collections = items(page)
            if collections:
                break
        history = request("/zvideo/video/v2/playlist", {"start": 1, "limit": 5})
        request("/zvideo/favorite/list", {"start": 1, "limit": 5})
        request("/zvideo/video/v2/lately", {"start": 1, "limit": 5})
        request("/zvideo/collection/filter/v2")
        if collections:
            sample = collections[0]
            collection_id = sample.get("collection_id")
            title = sample.get("title")
            if title:
                data = request("/zvideo/search/index", {"key_word": title}, "search_existing_title")
                report["search_title_match"] = any(
                    item.get("collection_id") == collection_id for item in
                    (data.get("collection", []) if isinstance(data, dict) else []))
                request("/zvideo/search/suggest", {"key_word": title[:4]})
            detail_form = {"collection_id": collection_id, "classification_id": category_id,
                           "get_type": "all"}
            request("/zvideo/collection/v2/info", detail_form)
            people = request("/zvideo/collection/person", {"collection_id": collection_id})
            actors = people.get("actor", []) if isinstance(people, dict) else []
            if actors and actors[0].get("name"):
                actor = actors[0]
                request("/zvideo/search/index", {"key_word": actor["name"]}, "search_existing_actor")
                request("/zvideo/person/collection/list", {
                    "person_name": actor["name"], "person_id": actor.get("id", actor.get("person_id", "")),
                    "collection_id": collection_id, "type": 0, "start": 1, "limit": 5,
                    "field": "release_year", "sort": "desc"})
            watched = next((item for item in items(history) if item.get("collection_id")
                            and item.get("classification_id")), sample)
            detail = request("/zvideo/collection/info", {
                "collection_id": watched.get("collection_id"),
                "classification_id": watched.get("classification_id", category_id),
                "get_type": "all"}, "history_read")
            record = detail.get("history") if isinstance(detail, dict) else None
            report["history_sample_from_playlist"] = watched is not sample
            report["history_has_video_id"] = bool(record.get("last_video_id")) if isinstance(record, dict) else False
            report["history_has_positive_position"] = isinstance(record, dict) and isinstance(
                record.get("play_duration"), (int, float)) and record["play_duration"] > 0
            report["result"] = "completed_read_probe"
        else:
            report["result"] = "no_sample_collection"
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"result": report["result"], "request_count": len(report["requests"]),
                      "requests": [{key: value for key, value in item.items() if key != "response_shape"}
                                   for item in report["requests"]]}))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(json.dumps({"result": "probe_error", "error_class": type(error).__name__}))
        sys.exit(1)
