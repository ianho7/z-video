//! Production-owner protocol regressions.
//!
//! These tests drive the public `NasClient` boundary through a local HTTP
//! server. The server responses are synthetic and contain no user session
//! material; they prove error/shape handling, not real NAS compatibility.

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use z_video::nas::{Episode, HttpNasClient, NasClient, NasDeviceMetadata, NasError, NasSession};
use z_video::playback::PlaybackProgressUpdate;

const FIXTURE_PUBLIC_KEY: &str =
    "MFwwDQYJKoZIhvcNAQEBBQADSwAwSAJBALKZ8KjQHGuJZx7HK65jCfI+UW7q/ts6HscZzFC0iwFeQjlj5XCKn2/iDsJwjssh0wR7oQNtt0fsAcoEE8VF9C8CAwEAAQ==";

fn key_response() -> String {
    format!(
        r#"{{"code":200,"data":{{"key":"{}","sign":"fixture-sign","name":"Fixture NAS"}}}}"#,
        FIXTURE_PUBLIC_KEY
    )
}

fn state_response() -> String {
    r#"{"code":200,"data":{"nasid":"fixture-nas"}}"#.to_string()
}

fn read_http_request(stream: &mut TcpStream) -> String {
    let mut request = Vec::new();
    let mut buffer = [0_u8; 4096];
    let header_end = loop {
        let read = stream.read(&mut buffer).expect("read HTTP request");
        assert!(read > 0, "client closed before sending HTTP request");
        request.extend_from_slice(&buffer[..read]);
        if let Some(position) = request.windows(4).position(|window| window == b"\r\n\r\n") {
            break position + 4;
        }
    };

    let headers = String::from_utf8_lossy(&request[..header_end]);
    let content_length = headers
        .lines()
        .find_map(|line| {
            let (name, value) = line.split_once(':')?;
            name.eq_ignore_ascii_case("Content-Length")
                .then_some(value.trim())
        })
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(0);

    while request.len() < header_end + content_length {
        let read = stream.read(&mut buffer).expect("read HTTP request body");
        assert!(read > 0, "client closed before sending HTTP request body");
        request.extend_from_slice(&buffer[..read]);
    }

    String::from_utf8_lossy(&request[..header_end + content_length]).into_owned()
}

fn write_json_response(stream: &mut TcpStream, body: &str) {
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    );
    stream
        .write_all(response.as_bytes())
        .expect("write synthetic JSON response");
}

fn spawn_response_server(responses: Vec<String>) -> (String, JoinHandle<Vec<String>>) {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind local protocol server");
    let address = listener.local_addr().expect("read local protocol address");
    let server = thread::spawn(move || {
        let mut requests = Vec::with_capacity(responses.len());
        for body in responses {
            let (mut stream, _) = listener.accept().expect("accept protocol request");
            requests.push(read_http_request(&mut stream));
            write_json_response(&mut stream, &body);
        }
        requests
    });

    (format!("http://{address}"), server)
}

fn authenticated_session(base_url: &str) -> NasSession {
    let session = NasSession::new(base_url.to_string());
    session.set_authenticated(
        "fixture-session".to_string(),
        "fixture-user".to_string(),
        None,
        None,
        Some("fixture-nas".to_string()),
    );
    session.set_nas_sign(Some("fixture-sign".to_string()));
    session.set_device_metadata(NasDeviceMetadata::client_defaults());
    session
}

fn collection_list_response(count_field: &str) -> String {
    format!(
        r#"{{"code":200,"data":{{"{count_field}":1,"classification_name":"Fixture category","list":[{{"collection_id":"fixture-collection","title":"Fixture title","release_year":2026,"video_type":"movie","score":8.8}}]}}}}"#
    )
}

#[test]
fn login_http_owner_accepts_integer_zero_and_one_for_boolish_response_field() {
    // Regression oracle: the real `/auth/login` failure was a JSON integer 0
    // being deserialized as a Rust boolean. The test drives the public login
    // owner and also verifies the post-login NAS identity refinement call.
    for (raw_value, expected) in [("0", false), ("1", true)] {
        let login_response = format!(
            r#"{{"code":200,"data":{{"token":"fixture-session","is_local":{raw_value}}}}}"#
        );
        let (base_url, server) =
            spawn_response_server(vec![key_response(), login_response, state_response()]);

        let response = HttpNasClient::new(Duration::from_secs(2))
            .login(&base_url, "fixture-user", "fixture-password", None)
            .expect("synthetic login response should parse");
        let requests = server.join().expect("login server should finish");

        assert_eq!(response.is_local, Some(expected));
        assert_eq!(response.nas_id.as_deref(), Some("fixture-nas"));
        assert!(requests[0].starts_with("GET /key/pub?signme=1"));
        assert!(requests[1].starts_with("POST /auth/login?&drnd="));
        assert!(requests[2].starts_with("GET /zhelper/state?&drnd="));
    }
}

#[test]
fn library_http_owner_accepts_number_and_string_field_variants() {
    let list_response = collection_list_response("count");
    let detail_response = r#"{
        "code": 200,
        "data": {
            "collection_id": "fixture-collection",
            "title": "Fixture title",
            "release_year": 2026,
            "type": "movie",
            "score": "8.8",
            "history": {
                "last_video_id": "fixture-video",
                "play_duration": "42",
                "audio_index": 1,
                "subtitle_index": "2",
                "subtitle_hash": "fixture-hash",
                "subtitle_setting": "default",
                "play_chapter": 0
            },
            "list": [{
                "season": "1",
                "version_list": [{
                    "video_id": "fixture-video",
                    "episode": 1,
                    "title": "Fixture episode",
                    "file_path": "fixture-media-reference"
                }]
            }]
        }
    }"#;
    let (base_url, server) =
        spawn_response_server(vec![list_response, detail_response.to_string()]);
    let session = authenticated_session(&base_url);
    let client = HttpNasClient::new(Duration::from_secs(2));

    let page = client
        .get_collections(&session, "fixture-category", 1, 50)
        .expect("mixed list fields should parse");
    assert_eq!(page.list[0].release_year, "2026");
    assert_eq!(page.list[0].display_score(), "8.8");

    let detail = client
        .get_collection_detail(&session, "fixture-collection", "fixture-category")
        .expect("mixed detail fields should parse");
    assert_eq!(detail.release_year, "2026");
    assert_eq!(detail.display_score(), "8.8");
    let history = detail.history.as_ref().expect("detail history should parse");
    assert_eq!(history.last_video_id.as_deref(), Some("fixture-video"));
    assert_eq!(history.play_duration, Some(42));
    assert_eq!(history.audio_index, Some(1));
    assert_eq!(history.subtitle_index, Some(2));
    assert_eq!(detail.seasons[0].season_number, 1);
    assert_eq!(detail.seasons[0].episodes[0].episode_number, 1);

    let requests = server.join().expect("library server should finish");
    assert!(requests[0].starts_with("POST /zvideo/video/v2/list?&drnd="));
    assert!(requests[1].starts_with("POST /zvideo/collection/v2/info?&drnd="));
}

#[test]
fn collection_detail_reads_legacy_history_when_v2_detail_omits_it() {
    let detail_without_history = r#"{
        "code": 200,
        "data": {
            "collection_id": "fixture-collection",
            "title": "Fixture title",
            "type": "movie",
            "list": [{
                "version_list": [{
                    "video_id": "fixture-video",
                    "episode": 1,
                    "file_path": "fixture-media-reference"
                }]
            }]
        }
    }"#;
    let legacy_history = r#"{
        "code": 200,
        "data": {
            "history": {
                "last_video_id": "fixture-video",
                "play_duration": 31
            }
        }
    }"#;
    let (base_url, server) = spawn_response_server(vec![
        collection_list_response("count"),
        detail_without_history.to_string(),
        legacy_history.to_string(),
    ]);
    let session = authenticated_session(&base_url);
    let client = HttpNasClient::new(Duration::from_secs(2));

    client
        .get_collections(&session, "fixture-category", 1, 50)
        .expect("collection list should parse");
    let detail = client
        .get_collection_detail(&session, "fixture-collection", "fixture-category")
        .expect("v2 detail plus legacy history should parse");

    let history = detail
        .history
        .as_ref()
        .expect("legacy history should be merged into detail");
    assert_eq!(history.last_video_id.as_deref(), Some("fixture-video"));
    assert_eq!(history.play_duration, Some(31));

    let requests = server.join().expect("legacy-history server should finish");
    assert!(requests[1].starts_with("POST /zvideo/collection/v2/info?&drnd="));
    assert!(requests[2].starts_with("POST /zvideo/collection/info?&drnd="));
}

#[test]
fn collection_list_http_owner_accepts_count_and_collection_count_aliases() {
    let (base_url, server) = spawn_response_server(vec![
        collection_list_response("count"),
        collection_list_response("collection_count"),
    ]);
    let session = authenticated_session(&base_url);
    let client = HttpNasClient::new(Duration::from_secs(2));

    let count_page = client
        .get_collections(&session, "fixture-category", 1, 50)
        .expect("count response should parse");
    let alias_page = client
        .get_collections(&session, "fixture-category", 1, 50)
        .expect("collection_count response should parse");

    assert_eq!(count_page.count, 1);
    assert_eq!(alias_page.count, 1);
    server.join().expect("count alias server should finish");
}

#[test]
fn missing_data_list_is_a_protocol_error_not_an_empty_success_page() {
    let missing_list =
        r#"{"code":200,"data":{"count":0,"classification_name":"Fixture category"}}"#;
    let (base_url, server) = spawn_response_server(vec![missing_list.to_string()]);
    let session = authenticated_session(&base_url);

    let error = HttpNasClient::new(Duration::from_secs(2))
        .get_collections(&session, "fixture-category", 1, 50)
        .expect_err("missing data.list must not become an empty page");
    assert!(matches!(
        error,
        NasError::MalformedResponse(message) if message.contains("data.list")
    ));
    server.join().expect("missing-list server should finish");
}

#[test]
fn invalid_classification_is_not_allowed_to_reuse_a_success_page() {
    let business_error = r#"{"code":"T000001","message":"分类参数无效","data":null}"#.to_string();
    let (base_url, server) =
        spawn_response_server(vec![collection_list_response("count"), business_error]);
    let session = authenticated_session(&base_url);
    let client = HttpNasClient::new(Duration::from_secs(2));

    let valid_page = client
        .get_collections(&session, "fixture-valid-category", 1, 50)
        .expect("valid classification should return a page");
    let error = client
        .get_collections(&session, "fixture-invalid-category", 1, 50)
        .expect_err("invalid classification must not return the previous page");

    assert_eq!(valid_page.list.len(), 1);
    assert!(matches!(
        error,
        NasError::Business { code, .. } if code == "T000001"
    ));

    let requests = server.join().expect("classification server should finish");
    assert!(requests[0].contains("classification_id=fixture-valid-category"));
    assert!(requests[1].contains("classification_id=fixture-invalid-category"));
}

#[test]
fn http_200_t000001_is_a_playback_business_error() {
    let business_error = r#"{"code":"T000001","message":"参数错误","data":null}"#;
    let (base_url, server) = spawn_response_server(vec![business_error.to_string()]);
    let session = authenticated_session(&base_url);
    let episode = Episode {
        file_path: "fixture-media-reference".to_string(),
        ..Episode::default()
    };

    let error = HttpNasClient::new(Duration::from_secs(2))
        .get_playback_stream(&session, &episode)
        .expect_err("HTTP 200 with T000001 must not become a stream");
    assert!(matches!(
        error,
        NasError::Business { code, message }
            if code == "T000001" && message == "参数错误"
    ));

    let requests = server.join().expect("playback error server should finish");
    assert!(requests[0].starts_with("GET /transcode/play?"));
}

#[test]
fn http_200_progress_business_error_is_not_a_save_receipt() {
    let business_error = r#"{"code":"T000001","message":"参数错误","data":null}"#;
    let (base_url, server) = spawn_response_server(vec![business_error.to_string()]);
    let session = authenticated_session(&base_url);
    let progress = PlaybackProgressUpdate {
        collection_id: "fixture-collection".to_string(),
        classification_id: "fixture-category".to_string(),
        video_id: "fixture-video".to_string(),
        sec: 42,
        chapter: 0,
        audio_index: 0,
        subtitle_index: 0,
        subtitle_hash: String::new(),
        video_duration: 120,
        subtitle_setting: String::new(),
    };

    let error = HttpNasClient::new(Duration::from_secs(2))
        .update_playback_progress(&session, &progress)
        .expect_err("HTTP 200 with a business error must not be treated as saved");
    assert!(matches!(
        error,
        NasError::Business { code, message }
            if code == "T000001" && message == "参数错误"
    ));

    let requests = server.join().expect("progress error server should finish");
    assert!(requests[0].starts_with("POST /zvideo/video/updateplaytime?&drnd="));
}
