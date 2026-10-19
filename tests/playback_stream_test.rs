use std::io::{Read, Write};
use std::net::TcpListener;
use std::thread;

use z_video::nas::{
    Episode, HttpNasClient, MockNasClient, NasClient, NasDeviceMetadata, NasSession,
};

fn authenticated_session() -> NasSession {
    let session = NasSession::new("http://nas.test:5055".to_string());
    session.set_authenticated(
        "session-token".to_string(),
        "viewer".to_string(),
        None,
        None,
        Some("nas-123".to_string()),
    );
    session.set_device_metadata(NasDeviceMetadata::client_defaults());
    session
}

#[test]
fn mock_client_returns_playback_uri_for_authenticated_episode() {
    let client = MockNasClient::new().with_playback_uri("/stream/movie-01");
    let episode = Episode {
        video_id: "movie-video".to_string(),
        file_path: "/media/movie.mkv".to_string(),
        ..Episode::default()
    };

    let stream = client
        .get_playback_stream(&authenticated_session(), &episode)
        .expect("authenticated mock playback should succeed");

    assert_eq!(stream.uri, "/stream/movie-01");
}

#[test]
fn http_playback_stream_preserves_server_tracks_and_unknown_fields() {
    let listener = TcpListener::bind("127.0.0.1:0").expect("test server should bind");
    let address = listener
        .local_addr()
        .expect("test server address should exist");
    let server = thread::spawn(move || {
        let (mut stream, _) = listener.accept().expect("playback request should arrive");
        let mut request = [0_u8; 4096];
        let _ = stream
            .read(&mut request)
            .expect("request should be readable");
        let request_text = String::from_utf8_lossy(&request);
        let request_line = request_text.lines().next().unwrap_or_default();
        assert!(request_line.starts_with("GET /transcode/play?"));
        assert!(request_line.contains("drnd="));
        assert!(request_line.contains("play_env=1"));
        assert!(request_line.contains("video_codec=hevc%2Ch264%2Cmpeg4"));
        assert!(request_line.contains("support_format=3"));
        assert!(request_line.contains("from="));
        assert!(request_line.contains("plat=pc"));
        assert!(request_line.contains("version=2.3.0"));
        assert!(request_line.contains("device_id=z-video-client-01"));
        assert!(request_line.contains("device=z-video-desktop"));
        assert!(!request_line.contains("token="));
        assert!(!request_line.contains("app="));
        assert!(!request_line.contains("nasid="));
        assert!(!request_line.contains("audio_codec="));
        assert!(request_text.contains("Cookie: app=video; token=session-token; plat=pc; nas_id=nas-123; version=2.3.0; device_id=z-video-client-01; device=z-video-desktop; _l=zh_cn"));
        let body = r#"{"code":200,"data":{"uri":"/stream/movie-01","audio_list":[{"index":0,"language":"原声"},{"index":1,"language":"国语"}],"subtitle_list":[{"index":0,"language":"中文"}],"future_server_field":{"keep":true}}}"#;
        write!(
            stream,
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        )
        .expect("playback response should be written");
    });

    let episode = Episode {
        video_id: "movie-video".to_string(),
        file_path: "/media/movie.mkv".to_string(),
        ..Episode::default()
    };
    let session = NasSession::new(format!("http://{}", address));
    session.set_authenticated(
        "session-token".to_string(),
        "viewer".to_string(),
        None,
        None,
        Some("nas-123".to_string()),
    );
    session.set_device_metadata(NasDeviceMetadata::client_defaults());
    let stream = HttpNasClient::default()
        .get_playback_stream(&session, &episode)
        .expect("HTTP playback response should parse");
    server.join().expect("test server should finish");

    assert_eq!(stream.audio_tracks.len(), 2);
    assert_eq!(stream.subtitle_tracks.len(), 1);
    assert_eq!(stream.extra_fields["future_server_field"]["keep"], true);
}
