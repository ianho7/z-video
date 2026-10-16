use z_video::nas::{Episode, MockNasClient, NasClient, NasSession};

fn authenticated_session() -> NasSession {
    let session = NasSession::new("http://nas.test:5055".to_string());
    session.set_authenticated(
        "session-token".to_string(),
        "viewer".to_string(),
        None,
        None,
        None,
    );
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
