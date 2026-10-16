use serde::{de::Error as _, Deserialize, Deserializer, Serialize, Serializer};
use serde_json::Value;
use std::collections::BTreeMap;
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
#[serde(deny_unknown_fields)]
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

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
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
#[serde(deny_unknown_fields)]
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

impl TryFrom<ScrapeRequestWire> for ScrapeRequest {
    type Error = ScrapeRequestError;

    fn try_from(request: ScrapeRequestWire) -> Result<Self, Self::Error> {
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
        ScrapeRequestWire::deserialize(deserializer).and_then(|request| {
            Self::try_from(request).map_err(D::Error::custom)
        })
    }
}

fn contains_path_separator(value: &str) -> bool {
    value.contains(['/', '\\'])
        || value.contains("://")
        || value.as_bytes().get(1) == Some(&b':')
}
