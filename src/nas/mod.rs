pub mod auth;
pub mod client;
pub mod crypto;
pub mod discovery;
pub mod models;
pub mod session;

pub use auth::{ApiResponse, AuthError, CloudPubKeyData, LoginResponseData, MfaProof, NasPubKeyData};
pub use client::{normalize_lan_url, HttpNasClient, MockNasClient, NasClient};
pub use crypto::{encrypt_credential, parse_public_key, CryptoError};
pub use discovery::{
    discover_local_nas, DiscoveryBackend, DiscoveryCancellation, DiscoveryConfig,
    DiscoveryError, DiscoveryErrorClass, DiscoveryReport, Ipv4Network, NasDiscoveryResult,
    NativeSdkStatus,
};
pub use models::{
    ClassificationItem, CollectionDetail, CollectionItem, CollectionPage, Episode, NasError,
    PlaybackHistory, Season,
};
pub use session::{NasDeviceMetadata, NasRequestContext, NasSession};

