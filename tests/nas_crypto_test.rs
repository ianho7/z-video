use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
use rand::rngs::OsRng;
use rsa::pkcs8::EncodePublicKey;
use rsa::traits::PublicKeyParts;
use rsa::{Pkcs1v15Encrypt, RsaPrivateKey, RsaPublicKey};
use z_video::nas::crypto::{encrypt_credential, parse_public_key};

#[test]
fn test_rsa_pkcs1_v15_encryption_and_decryption_with_utf8() {
    let mut rng = OsRng;
    let bits = 2048;
    let priv_key = RsaPrivateKey::new(&mut rng, bits).expect("generate private key");
    let pub_key = RsaPublicKey::from(&priv_key);

    let test_secret = "  极空间_SuperSecret#Password-2026!  \r\n";
    let encrypted_b64 = encrypt_credential(&pub_key, test_secret).expect("encrypt credential");

    let cipher_bytes = BASE64_STANDARD.decode(&encrypted_b64).expect("decode base64");
    let decrypted_bytes = priv_key
        .decrypt(Pkcs1v15Encrypt, &cipher_bytes)
        .expect("decrypt ciphertext");

    let decrypted = String::from_utf8(decrypted_bytes).expect("utf8 string");
    // Verify auto-trim behaviour
    assert_eq!(decrypted, "极空间_SuperSecret#Password-2026!");
}

#[test]
fn test_parse_public_key_pem_format() {
    let mut rng = OsRng;
    let priv_key = RsaPrivateKey::new(&mut rng, 1024).expect("generate key");
    let pub_key = RsaPublicKey::from(&priv_key);

    let pem = pub_key
        .to_public_key_pem(rsa::pkcs8::LineEnding::LF)
        .expect("export pem");

    let parsed = parse_public_key(&pem).expect("parse PEM key");
    assert_eq!(parsed.n(), pub_key.n());
    assert_eq!(parsed.e(), pub_key.e());
}

#[test]
fn test_parse_public_key_raw_base64_spki_der() {
    let mut rng = OsRng;
    let priv_key = RsaPrivateKey::new(&mut rng, 1024).expect("generate key");
    let pub_key = RsaPublicKey::from(&priv_key);

    let spki_doc = pub_key.to_public_key_der().expect("export spki der");
    let raw_b64 = BASE64_STANDARD.encode(spki_doc.as_bytes());

    let parsed = parse_public_key(&raw_b64).expect("parse raw base64 SPKI");
    assert_eq!(parsed.n(), pub_key.n());
    assert_eq!(parsed.e(), pub_key.e());
}

#[test]
fn test_parse_sample_zspace_cloud_and_nas_key() {
    // Official public key excerpt from static reverse analysis of Z-Space client
    let zspace_key_literal = "MFwwDQYJKoZIhvcNAQEBBQADSwAwSAJBALKZ8KjQHGuJZx7HK65jCfI+UW7q/ts6\nHscZzFC0iwFeQjlj5XCKn2/iDsJwjssh0wR7oQNtt0fsAcoEE8VF9C8CAwEAAQ==";

    let parsed = parse_public_key(zspace_key_literal).expect("must parse sample key");
    assert_eq!(parsed.size(), 64); // 512-bit key = 64 bytes
}

#[test]
fn test_parse_invalid_key_fails_gracefully() {
    assert!(parse_public_key("not_a_valid_key_string").is_err());
    assert!(parse_public_key("").is_err());
}
