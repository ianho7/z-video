use serde_json::Value;
use z_video::metadata::{
    CancellationToken, MetadataCandidate, MetadataContractVersion, MetadataDetails,
    MetadataProviderError, MetadataProviderResult, MetadataRequestId, ProviderInfo, ScrapeRequest,
};

#[test]
fn provider_info_round_trips_with_a_contract_version_separate_from_provider_version() {
    let provider = ProviderInfo {
        contract_version: MetadataContractVersion::current(),
        provider_id: "example.provider".to_string(),
        provider_version: "7.2.1".to_string(),
        capabilities: vec!["search".to_string(), "details".to_string()],
        extensions: Default::default(),
    };

    let encoded = serde_json::to_string(&provider).expect("provider info should serialize");
    let json: Value = serde_json::from_str(&encoded).expect("provider JSON should be valid");
    assert_eq!(json["contract_version"], 1);
    assert_eq!(json["provider_version"], "7.2.1");
    assert!(json.get("application_version").is_none());

    let decoded: ProviderInfo =
        serde_json::from_str(&encoded).expect("provider info should deserialize");
    assert_eq!(decoded, provider);

    let mut with_unknown_top_level = serde_json::to_value(&provider).unwrap();
    with_unknown_top_level["future_top_level"] = Value::Bool(true);
    let _: ProviderInfo = serde_json::from_value(with_unknown_top_level)
        .expect("unknown provider fields should be ignored");
}

#[test]
fn scrape_request_defaults_optional_fields_and_round_trips() {
    let request: ScrapeRequest = serde_json::from_str(
        r#"{
            "basename": "Example.Movie.2026.mkv",
            "future_top_level": true
        }"#,
    )
    .expect("sparse scrape request should deserialize");

    assert_eq!(request.contract_version, MetadataContractVersion::current());
    assert_eq!(request.basename.as_deref(), Some("Example.Movie.2026.mkv"));
    assert_eq!(request.user_supplied_id, None);
    assert_eq!(request.title, None);
    assert_eq!(request.language, None);

    let round_trip: ScrapeRequest = serde_json::from_str(
        &serde_json::to_string(&request).expect("scrape request should serialize"),
    )
    .expect("scrape request should round-trip");
    assert_eq!(round_trip, request);
}

#[test]
fn candidate_and_details_round_trip_without_nas_models() {
    let candidate_json = r#"{
        "contract_version": 1,
        "provider_id": "example.provider",
        "source_id": "source-42",
        "title": "Example Movie",
        "year": 2026,
        "date": "2026-01-02",
        "people": [{"name": "Example Director", "role": "director"}],
        "image_refs": [{"reference": "provider://poster/source-42", "kind": "poster"}],
        "extensions": {"future.provider": {"catalog_id": "catalog-42"}},
        "future_top_level": "ignored"
    }"#;
    let candidate: MetadataCandidate =
        serde_json::from_str(candidate_json).expect("candidate should deserialize");
    assert_eq!(candidate.provider_id, "example.provider");
    assert_eq!(candidate.source_id, "source-42");
    assert_eq!(candidate.title, "Example Movie");
    assert_eq!(candidate.people[0].name, "Example Director");
    assert_eq!(
        candidate.image_refs[0].reference,
        "provider://poster/source-42"
    );
    assert_eq!(
        candidate.extensions["future.provider"]["catalog_id"],
        Value::String("catalog-42".to_string())
    );
    let candidate_round_trip: MetadataCandidate = serde_json::from_value(
        serde_json::to_value(&candidate).expect("candidate should serialize"),
    )
    .expect("candidate should round-trip");
    assert_eq!(candidate_round_trip, candidate);

    let details_json = r#"{
        "source": {"provider_id": "example.provider", "source_id": "source-42"},
        "title": "Example Movie",
        "source_references": [{"provider_id": "example.provider", "source_id": "mirror-42"}],
        "extensions": {"future.provider": {"rating": 9}},
        "future_top_level": {"ignored": true}
    }"#;
    let details: MetadataDetails =
        serde_json::from_str(details_json).expect("details should deserialize");
    assert_eq!(details.source.source_id, "source-42");
    assert_eq!(details.title.as_deref(), Some("Example Movie"));
    assert_eq!(details.year, None);
    assert!(details.people.is_empty());
    assert_eq!(details.source_references[0].source_id, "mirror-42");
    assert_eq!(details.extensions["future.provider"]["rating"], 9);
    let details_round_trip: MetadataDetails =
        serde_json::from_value(serde_json::to_value(&details).expect("details should serialize"))
            .expect("details should round-trip");
    assert_eq!(details_round_trip, details);
}

#[test]
fn missing_optional_fields_and_unknown_namespaces_are_tolerated() {
    let candidate: MetadataCandidate = serde_json::from_str(
        r#"{
            "provider_id": "example.provider",
            "source_id": "source-1",
            "title": "Sparse Candidate",
            "extensions": {"unknown.namespace": {"opaque": [1, 2, 3]}}
        }"#,
    )
    .expect("candidate optional fields should default");
    assert_eq!(
        candidate.contract_version,
        MetadataContractVersion::current()
    );
    assert_eq!(candidate.year, None);
    assert_eq!(candidate.date, None);
    assert!(candidate.people.is_empty());
    assert!(candidate.image_refs.is_empty());
    assert_eq!(
        candidate.extensions["unknown.namespace"]["opaque"],
        serde_json::json!([1, 2, 3])
    );

    let details: MetadataDetails = serde_json::from_str(
        r#"{
            "source": {"provider_id": "example.provider", "source_id": "source-1"}
        }"#,
    )
    .expect("details optional fields should default");
    assert_eq!(details.contract_version, MetadataContractVersion::current());
    assert_eq!(details.title, None);
    assert_eq!(details.date, None);
    assert!(details.genres.is_empty());
    assert!(details.source_references.is_empty());
    assert!(details.extensions.is_empty());
}

#[test]
fn scrape_request_rejects_paths_and_urls_in_basename() {
    for basename in [
        r"C:\media\Example.Movie.mkv",
        "/media/Example.Movie.mkv",
        "https://example.test/Example.Movie.mkv",
    ] {
        let error = serde_json::from_value::<ScrapeRequest>(serde_json::json!({
            "basename": basename
        }))
        .expect_err("complete paths and URLs must not enter the request");
        assert!(error.to_string().contains("complete file path"));
    }
}

#[test]
fn provider_error_categories_and_cancellation_are_public_contract_behavior() {
    let errors = [
        (MetadataProviderError::NoMatch, "no_match"),
        (MetadataProviderError::Network, "network"),
        (
            MetadataProviderError::AuthenticationRequired,
            "authentication_required",
        ),
        (MetadataProviderError::Parse, "parse"),
        (MetadataProviderError::Cancelled, "cancelled"),
    ];
    for (error, serialized) in errors {
        assert_eq!(serde_json::to_value(error).unwrap(), serialized);
        assert_eq!(
            serde_json::from_value::<MetadataProviderError>(Value::String(serialized.to_string(),))
                .unwrap(),
            error
        );
    }

    let cancellation = CancellationToken::new();
    assert!(!cancellation.is_cancelled());
    let shared_cancellation = cancellation.clone();
    shared_cancellation.cancel();
    assert!(cancellation.is_cancelled());

    let old_result = MetadataProviderResult::new(MetadataRequestId::new(1), ());
    assert!(!old_result.applies_to(MetadataRequestId::new(2)));
    assert!(old_result.applies_to(MetadataRequestId::new(1)));
}
