use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
use rand::rngs::OsRng;
use rsa::pkcs1::DecodeRsaPublicKey;
use rsa::pkcs8::DecodePublicKey;
use rsa::{Pkcs1v15Encrypt, RsaPublicKey};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum CryptoError {
    #[error("Failed to decode base64 key: {0}")]
    Base64Decode(#[from] base64::DecodeError),
    #[error("Failed to parse RSA public key (tried SPKI DER, PKCS#1 DER, and PEM): {0}")]
    KeyParse(String),
    #[error("RSA encryption failed: {0}")]
    EncryptionFailed(String),
}

/// Parses an RSA public key from various formats used by Z-Space NAS / cloud APIs.
/// Supports raw Base64-encoded SPKI DER (as returned by /key/pub), PEM strings, and PKCS#1 DER.
pub fn parse_public_key(key_str: &str) -> Result<RsaPublicKey, CryptoError> {
    let clean = key_str.trim();

    // 1. If it's already in PEM format with header
    if clean.contains("-----BEGIN") {
        if let Ok(key) = RsaPublicKey::from_public_key_pem(clean) {
            return Ok(key);
        }
        if let Ok(key) = RsaPublicKey::from_pkcs1_pem(clean) {
            return Ok(key);
        }
    }

    // 2. Strip all whitespaces and newlines
    let b64_clean: String = clean.chars().filter(|c| !c.is_whitespace()).collect();

    // 3. Decode base64 bytes
    let der_bytes = BASE64_STANDARD.decode(&b64_clean)?;

    // 4. Try SPKI DER (X.509 SubjectPublicKeyInfo) - this is what Z-Space /key/pub returns
    if let Ok(key) = RsaPublicKey::from_public_key_der(&der_bytes) {
        return Ok(key);
    }

    // 5. Try PKCS#1 DER (RSAPublicKey)
    if let Ok(key) = RsaPublicKey::from_pkcs1_der(&der_bytes) {
        return Ok(key);
    }

    // 6. Try wrapping as standard PEM
    let pem_wrapper = format!(
        "-----BEGIN PUBLIC KEY-----\n{}\n-----END PUBLIC KEY-----",
        b64_clean
    );
    if let Ok(key) = RsaPublicKey::from_public_key_pem(&pem_wrapper) {
        return Ok(key);
    }

    Err(CryptoError::KeyParse(
        "Could not decode public key as SPKI DER, PKCS#1 DER, or PEM".to_string(),
    ))
}

/// Encrypts a plaintext credential using the NAS RSA public key with PKCS#1 v1.5 padding.
/// Following Z-Space specification, input text is trimmed first, encrypted, and returned as a Base64 string.
pub fn encrypt_credential(public_key: &RsaPublicKey, plaintext: &str) -> Result<String, CryptoError> {
    let trimmed = plaintext.trim();
    let mut rng = OsRng;
    let ciphertext = public_key
        .encrypt(&mut rng, Pkcs1v15Encrypt, trimmed.as_bytes())
        .map_err(|e| CryptoError::EncryptionFailed(e.to_string()))?;

    Ok(BASE64_STANDARD.encode(ciphertext))
}

#[cfg(test)]
mod tests {
    use super::*;
    use rsa::pkcs8::EncodePublicKey;
    use rsa::traits::PublicKeyParts;
    use rsa::{Pkcs1v15Encrypt, RsaPrivateKey};

    #[test]
    fn test_rsa_encrypt_decrypt_roundtrip() {
        let mut rng = OsRng;
        let bits = 2048;
        let priv_key = RsaPrivateKey::new(&mut rng, bits).expect("failed to generate key");
        let pub_key = RsaPublicKey::from(&priv_key);

        let test_password = "  my_secret_password_123 \n";
        let encrypted_b64 = encrypt_credential(&pub_key, test_password).expect("encryption failed");

        let cipher_bytes = BASE64_STANDARD.decode(&encrypted_b64).expect("decode failed");
        let decrypted_bytes = priv_key
            .decrypt(Pkcs1v15Encrypt, &cipher_bytes)
            .expect("decryption failed");

        let decrypted_str = String::from_utf8(decrypted_bytes).expect("utf8 failed");
        assert_eq!(decrypted_str, "my_secret_password_123");
    }

    #[test]
    fn test_parse_public_key_spki_der() {
        let mut rng = OsRng;
        let priv_key = RsaPrivateKey::new(&mut rng, 1024).expect("failed to generate key");
        let pub_key = RsaPublicKey::from(&priv_key);

        let spki_der = pub_key.to_public_key_der().expect("export spki der");
        let b64_spki = BASE64_STANDARD.encode(spki_der.as_bytes());

        let parsed = parse_public_key(&b64_spki).expect("parse spki failed");
        assert_eq!(parsed.n(), pub_key.n());
        assert_eq!(parsed.e(), pub_key.e());
    }

    #[test]
    fn test_parse_zspace_sample_public_key() {
        // Sample public key from reference/login-analysis.md (512-bit test/cloud key)
        let sample_key = "MFwwDQYJKoZIhvcNAQEBBQADSwAwSAJBALKZ8KjQHGuJZx7HK65jCfI+UW7q/ts6\nHscZzFC0iwFeQjlj5XCKn2/iDsJwjssh0wR7oQNtt0fsAcoEE8VF9C8CAwEAAQ==";
        let parsed = parse_public_key(sample_key).expect("failed to parse sample zspace key");
        assert!(parsed.size() > 0);
    }
}
