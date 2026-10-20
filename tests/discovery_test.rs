use std::net::Ipv4Addr;

use z_video::nas::discovery::{
    build_probe_url, classify_probe_error_message, parse_local_ipv4_networks,
    parse_probe_response, DiscoveryErrorClass,
};

#[test]
fn fallback_probe_uses_the_confirmed_nas_key_endpoint() {
    assert_eq!(
        build_probe_url(Ipv4Addr::new(192, 168, 5, 2)),
        "http://192.168.5.2:5055/key/pub?signme=1"
    );
}

#[test]
fn probe_response_keeps_sign_separate_from_nas_id() {
    let result = parse_probe_response(
        r#"{
            "code": 200,
            "data": {"key": "public-key", "sign": "opaque-sign", "name": "客厅 NAS"}
        }"#,
        Ipv4Addr::new(192, 168, 5, 2),
    )
    .expect("valid NAS key response should parse");

    assert_eq!(result.ip, Ipv4Addr::new(192, 168, 5, 2));
    assert_eq!(result.name.as_deref(), Some("客厅 NAS"));
    assert_eq!(result.nas_id, None);
    assert_eq!(result.nas_sign.as_deref(), Some("opaque-sign"));
    assert!(result.available);
}

#[test]
fn probe_response_rejects_empty_or_business_error_responses() {
    let empty = parse_probe_response(
        r#"{"code":200,"data":{"key":"","name":"NAS"}}"#,
        Ipv4Addr::new(192, 168, 5, 2),
    )
    .expect_err("empty public key must not count as NAS");
    assert_eq!(empty.class(), DiscoveryErrorClass::MalformedResponse);

    let business = parse_probe_response(
        r#"{"code":403,"msg":"forbidden","data":null}"#,
        Ipv4Addr::new(192, 168, 5, 2),
    )
    .expect_err("business error must not count as NAS");
    assert_eq!(business.class(), DiscoveryErrorClass::Business);
}

#[test]
fn local_network_parser_only_accepts_private_ipv4_interfaces() {
    let output = r#"
        IPv4 Address. . . . . . . . . . . : 198.18.0.1
        Subnet Mask . . . . . . . . . . . : 255.255.255.252
        IPv4 Address. . . . . . . . . . . : 192.168.5.9
        Subnet Mask . . . . . . . . . . . : 255.255.255.0
    "#;

    let networks = parse_local_ipv4_networks(output);
    assert_eq!(networks.len(), 1);
    assert_eq!(networks[0].address, Ipv4Addr::new(192, 168, 5, 9));
    assert_eq!(networks[0].prefix_len, 24);
}

#[test]
fn probe_error_classification_distinguishes_timeout() {
    assert_eq!(
        classify_probe_error_message("request timed out"),
        DiscoveryErrorClass::Timeout
    );
    assert_eq!(
        classify_probe_error_message("connection refused"),
        DiscoveryErrorClass::Network
    );
}
