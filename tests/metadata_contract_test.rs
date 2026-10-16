use serde_json::Value;
use z_video::metadata::{MetadataContractVersion, ProviderInfo, ScrapeRequest};

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
}

#[test]
fn scrape_request_defaults_optional_fields_and_round_trips() {
    let request: ScrapeRequest = serde_json::from_str(
        r#"{
            "basename": "Example.Movie.2026.mkv"
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
