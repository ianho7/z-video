use serde::{de::Error as _, Deserialize, Deserializer, Serialize, Serializer};
use serde_json::Value;
use std::collections::BTreeMap;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use thiserror::Error;

pub const CURRENT_METADATA_CONTRACT_VERSION: u16 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct MetadataContractVersion(u16);

impl MetadataContractVersion {
    pub const fn current() -> Self {
        Self(CURRENT_METADATA_CONTRACT_VERSION)
    }

    pub const fn value(self) -> u16 {
        self.0
    }

    pub fn try_new(value: u16) -> Result<Self, UnsupportedMetadataContractVersion> {
        if value == CURRENT_METADATA_CONTRACT_VERSION {
            Ok(Self(value))
        } else {
            Err(UnsupportedMetadataContractVersion(value))
        }
    }
}

impl Default for MetadataContractVersion {
    fn default() -> Self {
        Self::current()
    }
}

impl Serialize for MetadataContractVersion {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_u16(self.0)
    }
}

impl<'de> Deserialize<'de> for MetadataContractVersion {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = u16::deserialize(deserializer)?;
        Self::try_new(value).map_err(D::Error::custom)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Error)]
#[error("unsupported metadata contract version: {0}")]
pub struct UnsupportedMetadataContractVersion(pub u16);

pub type MetadataExtensions = BTreeMap<String, BTreeMap<String, Value>>;

fn default_contract_version() -> MetadataContractVersion {
    MetadataContractVersion::current()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ProviderInfo {
    #[serde(default = "default_contract_version")]
    pub contract_version: MetadataContractVersion,
    pub provider_id: String,
    pub provider_version: String,
    #[serde(default)]
    pub capabilities: Vec<String>,
    #[serde(default)]
    pub extensions: MetadataExtensions,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MetadataSource {
    pub provider_id: String,
    pub source_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MetadataPerson {
    pub name: String,
    #[serde(default)]
    pub role: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ImageReference {
    pub reference: String,
    #[serde(default)]
    pub kind: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MetadataCandidate {
    #[serde(default = "default_contract_version")]
    pub contract_version: MetadataContractVersion,
    pub provider_id: String,
    pub source_id: String,
    pub title: String,
    #[serde(default)]
    pub year: Option<u16>,
    #[serde(default)]
    pub date: Option<String>,
    #[serde(default)]
    pub people: Vec<MetadataPerson>,
    #[serde(default)]
    pub image_refs: Vec<ImageReference>,
    #[serde(default)]
    pub extensions: MetadataExtensions,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MetadataDetails {
    #[serde(default = "default_contract_version")]
    pub contract_version: MetadataContractVersion,
    pub source: MetadataSource,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub original_title: Option<String>,
    #[serde(default)]
    pub year: Option<u16>,
    #[serde(default)]
    pub date: Option<String>,
    #[serde(default)]
    pub synopsis: Option<String>,
    #[serde(default)]
    pub genres: Vec<String>,
    #[serde(default)]
    pub people: Vec<MetadataPerson>,
    #[serde(default)]
    pub image_refs: Vec<ImageReference>,
    #[serde(default)]
    pub source_references: Vec<MetadataSource>,
    #[serde(default)]
    pub extensions: MetadataExtensions,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Error)]
#[serde(rename_all = "snake_case")]
pub enum MetadataProviderError {
    #[error("no metadata match")]
    NoMatch,
    #[error("metadata provider network failure")]
    Network,
    #[error("metadata provider authentication required")]
    AuthenticationRequired,
    #[error("metadata provider response parse failed")]
    Parse,
    #[error("metadata provider request cancelled")]
    Cancelled,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct MetadataRequestId(u64);

impl MetadataRequestId {
    pub const fn new(value: u64) -> Self {
        Self(value)
    }

    pub const fn value(self) -> u64 {
        self.0
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct MetadataProviderResult<T> {
    pub request_id: MetadataRequestId,
    pub value: T,
}

impl<T> MetadataProviderResult<T> {
    pub const fn new(request_id: MetadataRequestId, value: T) -> Self {
        Self { request_id, value }
    }

    pub const fn applies_to(&self, current_request_id: MetadataRequestId) -> bool {
        self.request_id == current_request_id
    }
}

#[derive(Debug, Clone)]
pub struct CancellationToken(Arc<AtomicBool>);

impl CancellationToken {
    pub fn new() -> Self {
        Self(Arc::new(AtomicBool::new(false)))
    }

    pub fn cancel(&self) {
        self.0.store(true, Ordering::Release);
    }

    pub fn is_cancelled(&self) -> bool {
        self.0.load(Ordering::Acquire)
    }
}

impl Default for CancellationToken {
    fn default() -> Self {
        Self::new()
    }
}

/// Synchronous contract for metadata search and detail lookup.
///
/// Implementations should return [`MetadataProviderError::Cancelled`] after
/// observing a cancelled token. Callers must apply a result only when
/// [`MetadataProviderResult::applies_to`] matches the current request ID.
pub trait MetadataProvider {
    fn search_candidates(
        &self,
        request_id: MetadataRequestId,
        request: &ScrapeRequest,
        cancellation: &CancellationToken,
    ) -> Result<MetadataProviderResult<Vec<MetadataCandidate>>, MetadataProviderError>;

    fn get_details(
        &self,
        request_id: MetadataRequestId,
        source: &MetadataSource,
        cancellation: &CancellationToken,
    ) -> Result<MetadataProviderResult<MetadataDetails>, MetadataProviderError>;
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct ScrapeRequest {
    #[serde(default = "default_contract_version")]
    pub contract_version: MetadataContractVersion,
    #[serde(default)]
    pub basename: Option<String>,
    #[serde(default)]
    pub user_supplied_id: Option<String>,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub language: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct ScrapeRequestWire {
    #[serde(default = "default_contract_version")]
    contract_version: MetadataContractVersion,
    #[serde(default)]
    basename: Option<String>,
    #[serde(default)]
    user_supplied_id: Option<String>,
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    language: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Error)]
pub enum ScrapeRequestError {
    #[error("scrape request basename must not contain a complete file path")]
    CompletePathInBasename,
}

impl ScrapeRequest {
    fn from_wire(request: ScrapeRequestWire) -> Result<Self, ScrapeRequestError> {
        if request
            .basename
            .as_deref()
            .is_some_and(contains_path_separator)
        {
            return Err(ScrapeRequestError::CompletePathInBasename);
        }

        Ok(Self {
            contract_version: request.contract_version,
            basename: request.basename,
            user_supplied_id: request.user_supplied_id,
            title: request.title,
            language: request.language,
        })
    }
}

impl<'de> Deserialize<'de> for ScrapeRequest {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        ScrapeRequestWire::deserialize(deserializer)
            .and_then(|request| Self::from_wire(request).map_err(D::Error::custom))
    }
}

fn contains_path_separator(value: &str) -> bool {
    value.contains(['/', '\\']) || value.contains("://") || value.as_bytes().get(1) == Some(&b':')
}
