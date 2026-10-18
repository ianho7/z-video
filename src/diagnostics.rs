//! Local, structured diagnostics for investigating real app failures.
//!
//! The public surface deliberately accepts only small, structured summaries.
//! Secrets, request bodies, and private media paths never need to cross this
//! module's boundary.

use serde_json::{Map, Value};
use std::fs::{create_dir_all, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{sync_channel, SyncSender, TrySendError};
use std::sync::OnceLock;
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const QUEUE_CAPACITY: usize = 512;
const LOG_FILE_NAME: &str = "diagnostics.jsonl";
const LOG_DIR_ENV: &str = "Z_VIDEO_LOG_DIR";

static LOGGER: OnceLock<DiagnosticLogger> = OnceLock::new();

struct DiagnosticLogger {
    sender: SyncSender<DiagnosticMessage>,
}

enum DiagnosticMessage {
    Line(String),
    Flush(SyncSender<()>),
}

/// A non-blocking operation span. Dropping an unfinished span leaves an
/// `abandoned` receipt so a cancelled background task is still visible.
pub struct EventSpan {
    event_type: String,
    operation: String,
    started_at: Instant,
    finished: bool,
}

/// Starts a structured diagnostic operation.
pub fn start_event(event_type: &str, operation: &str) -> EventSpan {
    record_event(
        event_type,
        operation,
        "start",
        "started",
        Duration::ZERO,
        &[],
    );
    EventSpan {
        event_type: event_type.to_string(),
        operation: operation.to_string(),
        started_at: Instant::now(),
        finished: false,
    }
}

impl EventSpan {
    /// Finishes the operation without affecting the business result.
    pub fn finish(mut self, result: &str, fields: &[(&str, String)]) {
        self.finished = true;
        record_event(
            &self.event_type,
            &self.operation,
            "complete",
            result,
            self.started_at.elapsed(),
            fields,
        );
    }
}

impl Drop for EventSpan {
    fn drop(&mut self) {
        if !self.finished {
            record_event(
                &self.event_type,
                &self.operation,
                "complete",
                "abandoned",
                self.started_at.elapsed(),
                &[],
            );
        }
    }
}

/// Records a structured app/UI event. The call only enqueues a JSON line and
/// never waits for disk I/O.
pub fn record_event(
    event_type: &str,
    operation: &str,
    phase: &str,
    result: &str,
    duration: Duration,
    fields: &[(&str, String)],
) {
    let line = encode_event(event_type, operation, phase, result, duration, fields);
    let logger = LOGGER.get_or_init(start_logger);
    match logger.sender.try_send(DiagnosticMessage::Line(line)) {
        Ok(()) | Err(TrySendError::Full(_)) | Err(TrySendError::Disconnected(_)) => {}
    }
}

/// Waits for queued diagnostics to reach the file. This is intended for
/// process shutdown, never for the UI event thread.
pub fn flush() {
    let Some(logger) = LOGGER.get() else { return };
    let (ack_sender, ack_receiver) = sync_channel(0);
    if logger
        .sender
        .send(DiagnosticMessage::Flush(ack_sender))
        .is_ok()
    {
        let _ = ack_receiver.recv_timeout(Duration::from_secs(2));
    }
}

/// Records one HTTP request without accepting a request body or secret.
pub fn record_nas_request(
    operation: &str,
    method: &str,
    path: &str,
    status: Option<u16>,
    duration: Duration,
    result: &str,
    parse_result: &str,
    business_result: &str,
    error_class: Option<&str>,
) {
    record_nas_request_with_code(
        operation,
        method,
        path,
        status,
        duration,
        result,
        parse_result,
        business_result,
        error_class,
        None,
    );
}

/// Records one HTTP request and an opaque server error code when one is
/// available. Error codes are safe to retain and are useful for matching a
/// UI error such as `N001212` to the exact request that produced it.
pub fn record_nas_request_with_code(
    operation: &str,
    method: &str,
    path: &str,
    status: Option<u16>,
    duration: Duration,
    result: &str,
    parse_result: &str,
    business_result: &str,
    error_class: Option<&str>,
    error_code: Option<&str>,
) {
    let mut fields = vec![
        ("method", method.to_string()),
        ("path", path.to_string()),
        ("parse_result", parse_result.to_string()),
        ("business_result", business_result.to_string()),
    ];
    if let Some(status) = status {
        fields.push(("http_status", status.to_string()));
    }
    if let Some(error_class) = error_class {
        fields.push(("error_class", error_class.to_string()));
    }
    if let Some(error_code) = error_code {
        fields.push(("error_code", error_code.to_string()));
    }
    record_event(
        "nas.request",
        operation,
        "complete",
        result,
        duration,
        &fields,
    );
}

/// Resolves the directory used by the writer. Keeping this pure makes the
/// Windows fallback testable without changing process-global environment.
pub fn log_directory(local_app_data: Option<&Path>, temp_dir: &Path) -> PathBuf {
    let base = local_app_data
        .filter(|path| !path.as_os_str().is_empty())
        .unwrap_or(temp_dir);
    base.join("z-video").join("logs")
}

pub fn log_file_path() -> PathBuf {
    if let Some(override_dir) = std::env::var_os(LOG_DIR_ENV)
        .map(PathBuf::from)
        .filter(|path| !path.as_os_str().is_empty())
    {
        return override_dir.join(LOG_FILE_NAME);
    }

    let local_app_data = std::env::var_os("LOCALAPPDATA").map(PathBuf::from);
    log_directory(local_app_data.as_deref(), &std::env::temp_dir()).join(LOG_FILE_NAME)
}

/// Removes query secrets and private media paths while retaining a useful API
/// route and safe numeric/query summaries.
pub fn sanitize_request_path(raw: &str) -> String {
    let input = raw.trim();
    if input.is_empty() {
        return "/".to_string();
    }

    let without_fragment = input.split('#').next().unwrap_or(input);
    let path_and_query = if let Some((_, rest)) = without_fragment.split_once("://") {
        rest.find('/').map(|index| &rest[index..]).unwrap_or("/")
    } else {
        without_fragment
    };
    let (path, query) = path_and_query
        .split_once('?')
        .map_or((path_and_query, None), |(path, query)| (path, Some(query)));

    let path = if is_private_media_path(path) {
        "/[REDACTED_MEDIA_PATH]".to_string()
    } else if path.starts_with('/') {
        path.to_string()
    } else {
        format!("/{path}")
    };

    let Some(query) = query else { return path };
    let safe_query = query
        .split('&')
        .filter_map(|part| {
            let (key, value) = part.split_once('=').unwrap_or((part, ""));
            let key_lower = key.trim().to_ascii_lowercase();
            if key_lower.is_empty() || is_sensitive_query_key(&key_lower) {
                return None;
            }
            let safe_value = sanitize_query_value(&key_lower, value);
            Some(format!("{}={safe_value}", key.trim()))
        })
        .collect::<Vec<_>>();

    if safe_query.is_empty() {
        path
    } else {
        format!("{path}?{}", safe_query.join("&"))
    }
}

fn start_logger() -> DiagnosticLogger {
    let (sender, receiver) = sync_channel::<DiagnosticMessage>(QUEUE_CAPACITY);
    let path = log_file_path();
    let _ = thread::Builder::new()
        .name("z-video-diagnostics".to_string())
        .spawn(move || {
            while let Ok(message) = receiver.recv() {
                match message {
                    DiagnosticMessage::Line(line) => {
                        if let Err(error) = append_line(&path, &line) {
                            log::warn!("diagnostic log write failed: {error}");
                        }
                    }
                    DiagnosticMessage::Flush(ack_sender) => {
                        let _ = ack_sender.send(());
                    }
                }
            }
        });
    DiagnosticLogger { sender }
}

fn append_line(path: &Path, line: &str) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        create_dir_all(parent)?;
    }
    let mut file = OpenOptions::new().create(true).append(true).open(path)?;
    file.write_all(line.as_bytes())?;
    file.write_all(b"\n")
}

fn encode_event(
    event_type: &str,
    operation: &str,
    phase: &str,
    result: &str,
    duration: Duration,
    fields: &[(&str, String)],
) -> String {
    let mut event = Map::new();
    event.insert(
        "timestamp_utc".to_string(),
        Value::String(format_utc_timestamp(SystemTime::now())),
    );
    event.insert(
        "event_type".to_string(),
        Value::String(sanitize_label(event_type)),
    );
    event.insert(
        "operation".to_string(),
        Value::String(sanitize_label(operation)),
    );
    event.insert("phase".to_string(), Value::String(sanitize_label(phase)));
    event.insert("result".to_string(), Value::String(sanitize_label(result)));
    event.insert(
        "duration_ms".to_string(),
        Value::Number((duration.as_millis().min(u64::MAX as u128) as u64).into()),
    );

    let mut details = Map::new();
    for (key, value) in fields {
        if let Some((safe_key, safe_value)) = sanitize_field(key, value) {
            details.insert(safe_key, safe_value);
        }
    }
    if !details.is_empty() {
        event.insert("details".to_string(), Value::Object(details));
    }

    serde_json::to_string(&event).unwrap_or_else(|_| {
        "{\"event_type\":\"diagnostics\",\"operation\":\"serialization_failed\",\"phase\":\"complete\",\"result\":\"error\",\"duration_ms\":0}".to_string()
    })
}

fn sanitize_field(key: &str, value: &str) -> Option<(String, Value)> {
    let key = key.trim().to_ascii_lowercase();
    let value = value.trim();
    let safe_value = match key.as_str() {
        "path" => Value::String(sanitize_request_path(value)),
        "method" => Value::String(sanitize_label(value)),
        "http_status" | "item_count" | "category_count" | "count" | "category_item_count"
        | "bytes" | "sec" | "duration_sec" | "video_duration" | "response_code"
        | "system" | "start" | "limit" => {
            Value::Number(value.parse::<u64>().unwrap_or(0).into())
        }
        "authenticated"
        | "remember"
        | "token_present"
        | "nas_id_present"
        | "nas_sign_present" => Value::Bool(value.eq_ignore_ascii_case("true")),
        "classification_id" | "selected_id" | "collection_id" | "episode_id" => {
            Value::String(mask_identifier(value))
        }
        "error_class" | "error_code" | "parse_result" | "business_result" | "storage"
        | "backend"
        | "view"
        | "challenge_type"
        | "reason"
        | "media_state"
        | "response_keys" => {
            Value::String(sanitize_label(value))
        }
        // Unknown fields are dropped instead of trusting every future caller.
        _ => return None,
    };
    Some((key, safe_value))
}

fn sanitize_label(value: &str) -> String {
    let mut label = value
        .chars()
        .filter(|character| {
            character.is_ascii_alphanumeric()
                || matches!(character, '_' | '-' | '.' | ':' | '/' | '[' | ']' | '…')
        })
        .collect::<String>();
    if label.len() > 96 {
        label.truncate(96);
    }
    label
}

fn mask_identifier(value: &str) -> String {
    if value.is_empty() || value.contains('/') || value.contains('\\') {
        return "[REDACTED_ID]".to_string();
    }
    let chars = value.chars().collect::<Vec<_>>();
    if chars.len() <= 4 {
        return "[ID]".to_string();
    }
    let prefix = chars.iter().take(2).collect::<String>();
    let suffix = chars.iter().rev().take(2).collect::<Vec<_>>();
    format!("{prefix}…{}", suffix.into_iter().rev().collect::<String>())
}

fn is_private_media_path(path: &str) -> bool {
    let lower = path.to_ascii_lowercase();
    lower.contains("/splay/")
        || lower.starts_with("/media/")
        || lower.contains("/private/")
        || lower.ends_with(".mkv")
        || lower.ends_with(".mp4")
        || lower.ends_with(".avi")
        || lower.ends_with(".ts")
}

fn is_sensitive_query_key(key: &str) -> bool {
    matches!(
        key,
        "token"
            | "rnd"
            | "password"
            | "username"
            | "sms_code"
            | "sms_proof"
            | "proof"
            | "key"
            | "key_id"
            | "nasid"
            | "nas_id"
            | "cookie"
            | "authorization"
            | "file_path"
            | "encrypted_path"
            | "device_id"
    )
}

fn sanitize_query_value(key: &str, value: &str) -> String {
    if matches!(key, "classification_id" | "collection_id" | "video_id") {
        return mask_identifier(value);
    }
    if value
        .chars()
        .all(|character| character.is_ascii_digit() || matches!(character, '.' | '-' | ',' | '_'))
    {
        value.chars().take(32).collect()
    } else if matches!(key, "system" | "start" | "limit" | "play_env") {
        "[REDACTED]".to_string()
    } else {
        "[REDACTED]".to_string()
    }
}

fn format_utc_timestamp(time: SystemTime) -> String {
    let duration = time.duration_since(UNIX_EPOCH).unwrap_or_default();
    let seconds = duration.as_secs();
    let days = (seconds / 86_400) as i64;
    let seconds_of_day = seconds % 86_400;
    let (year, month, day) = civil_date_from_days(days);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{:03}Z",
        seconds_of_day / 3_600,
        (seconds_of_day / 60) % 60,
        seconds_of_day % 60,
        duration.subsec_millis()
    )
}

fn civil_date_from_days(days_since_epoch: i64) -> (i64, i64, i64) {
    let z = days_since_epoch + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let day_of_era = z - era * 146_097;
    let year_of_era =
        (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let year = year_of_era + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_part = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_part + 2) / 5 + 1;
    let month = month_part + if month_part < 10 { 3 } else { -9 };
    let year = year + if month <= 2 { 1 } else { 0 };
    (year, month, day)
}

#[cfg(test)]
mod tests {
    use super::{encode_event, log_directory, sanitize_request_path};
    use serde_json::Value;
    use std::path::Path;
    use std::time::Duration;

    #[test]
    fn log_directory_falls_back_to_temp_dir_without_local_appdata() {
        assert_eq!(
            log_directory(None, Path::new("C:/Temp")),
            Path::new("C:/Temp/z-video/logs")
        );
        assert_eq!(
            log_directory(
                Some(Path::new("C:/Users/test/AppData/Local")),
                Path::new("C:/Temp")
            ),
            Path::new("C:/Users/test/AppData/Local/z-video/logs")
        );
    }

    #[test]
    fn request_path_redacts_secrets_and_private_media_paths() {
        let path = sanitize_request_path(
            "https://nas.example/zvideo/video/v2/list?token=secret-token&rnd=123&classification_id=movie-01&limit=50",
        );
        assert!(path.starts_with("/zvideo/video/v2/list"));
        assert!(!path.contains("secret-token"));
        assert!(!path.contains("rnd"));
        assert!(!path.contains("token"));
        assert!(!path.contains("movie-01"));

        assert_eq!(
            sanitize_request_path("http://nas/splay/opaque/private/movie.mkv?token=secret"),
            "/[REDACTED_MEDIA_PATH]"
        );
    }

    #[test]
    fn encoded_event_is_one_parseable_jsonl_record_without_sensitive_fields() {
        let line = encode_event(
            "nas.request",
            "library.collections",
            "complete",
            "success",
            Duration::from_millis(12),
            &[
                ("method", "POST".to_string()),
                (
                    "path",
                    "/zvideo/video/v2/list?token=secret&rnd=123".to_string(),
                ),
                ("http_status", "200".to_string()),
                ("item_count", "4".to_string()),
                ("password", "secret-password".to_string()),
            ],
        );

        let value: Value = serde_json::from_str(&line).expect("diagnostic line must be JSON");
        assert_eq!(value["event_type"], "nas.request");
        assert_eq!(value["operation"], "library.collections");
        assert_eq!(value["phase"], "complete");
        assert_eq!(value["result"], "success");
        assert_eq!(value["duration_ms"], 12);
        assert_eq!(value["details"]["http_status"], 200);
        assert_eq!(value["details"]["item_count"], 4);
        let serialized = line.to_ascii_lowercase();
        assert!(!serialized.contains("secret-password"));
        assert!(!serialized.contains("secret-token"));
        assert!(!serialized.contains("password"));
    }
}
