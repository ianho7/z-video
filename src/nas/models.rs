use serde::{de::Error as _, Deserialize, Serialize};
use serde_json::Value;
use thiserror::Error;

use crate::nas::auth::{sanitize_log_message, AuthError};

/// Classification category item returned by `POST /zvideo/classification/list`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ClassificationItem {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub is_system: i32,
    #[serde(default)]
    pub is_enable: i32,
    #[serde(default, alias = "collection_count", alias = "collectionCount")]
    pub count: i64,
}

impl ClassificationItem {
    /// Determines whether the classification item should be visible in the navigation sidebar.
    /// According to Z-Space web client logic:
    /// Non-system categories are always visible; system categories are visible only when `is_enable == 1`.
    pub fn is_visible(&self) -> bool {
        self.is_system != 1 || (self.is_system == 1 && self.is_enable == 1)
    }
}

/// Collection card item returned in the list array of `POST /zvideo/video/v2/list`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CollectionItem {
    pub collection_id: String,
    pub title: String,
    #[serde(default, deserialize_with = "deserialize_string_value")]
    pub cover: String,
    #[serde(default, deserialize_with = "deserialize_string_value")]
    pub release_year: String,
    #[serde(default, deserialize_with = "deserialize_string_value")]
    pub video_type: String,
    #[serde(default, deserialize_with = "deserialize_optional_string")]
    pub score: Option<String>,
    #[serde(default, deserialize_with = "deserialize_optional_string")]
    pub rating: Option<String>,
    #[serde(default)]
    pub episode_count: Option<i32>,
    #[serde(default, deserialize_with = "deserialize_optional_string")]
    pub storyline: Option<String>,
}

impl CollectionItem {
    /// Returns the effective score/rating string (e.g. "9.2" or empty).
    pub fn display_score(&self) -> String {
        if let Some(s) = &self.score {
            if !s.is_empty() && s != "0" && s != "0.0" {
                return s.clone();
            }
        }
        if let Some(r) = &self.rating {
            if !r.is_empty() && r != "0" && r != "0.0" {
                return r.clone();
            }
        }
        "".to_string()
    }

    /// Returns a human-friendly video type label (e.g., "电影", "电视剧").
    pub fn display_type(&self) -> &str {
        match self.video_type.as_str() {
            "movie" => "电影",
            "tv" => "剧集",
            "anime" => "动漫",
            "show" => "综艺",
            "diy" => "自建合集",
            _ => "影视",
        }
    }
}

/// A single playable unit returned by a collection detail response.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct Episode {
    #[serde(default)]
    pub video_id: String,
    #[serde(default)]
    pub episode_number: u32,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub file_path: String,
    #[serde(default)]
    pub version_id: String,
    #[serde(default)]
    pub duration: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub encrypted_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub from: Option<String>,
}

impl Episode {
    /// Returns the stable identifier used by the UI for selection.
    pub fn selection_id(&self) -> &str {
        if !self.video_id.is_empty() {
            &self.video_id
        } else if !self.version_id.is_empty() {
            &self.version_id
        } else {
            &self.file_path
        }
    }
}

/// Resume information returned by the detail endpoint's `data.history` object.
///
/// These fields are optional because the NAS omits `history` when there is no
/// saved progress. The endpoint has been observed to return numeric values as
/// either JSON numbers or strings, so the parser normalizes both forms.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct PlaybackHistory {
    #[serde(default, deserialize_with = "deserialize_optional_string")]
    pub last_video_id: Option<String>,
    #[serde(default, deserialize_with = "deserialize_optional_i64")]
    pub play_duration: Option<i64>,
    #[serde(default, deserialize_with = "deserialize_optional_i64")]
    pub audio_index: Option<i64>,
    #[serde(default, deserialize_with = "deserialize_optional_i64")]
    pub subtitle_index: Option<i64>,
    #[serde(default, deserialize_with = "deserialize_optional_string")]
    pub subtitle_hash: Option<String>,
    #[serde(default, deserialize_with = "deserialize_optional_string")]
    pub subtitle_setting: Option<String>,
    #[serde(default, deserialize_with = "deserialize_optional_i64")]
    pub play_chapter: Option<i64>,
}

impl PlaybackHistory {
    /// Extracts the optional `history` object from a collection-detail data value.
    ///
    /// The production detail parser uses the same helper, while this method
    /// keeps the response boundary directly testable without retaining raw JSON.
    pub fn from_detail_data(value: &Value) -> Option<Self> {
        value.get("history").and_then(parse_playback_history)
    }
}

/// Episodes grouped by season for presentation in the collection detail view.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct Season {
    #[serde(default)]
    pub season_number: u32,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub episodes: Vec<Episode>,
}

/// Collection metadata and its normalized episode/season structure.
///
/// The NAS response is not a stable public schema: known responses put playable
/// entries under `list[].version_list`, while other responses expose
/// `video_list`/`episodes` directly. Deserialization accepts those variants and
/// normalizes them into `seasons` without requiring optional metadata.
#[derive(Debug, Clone, Default, Serialize, PartialEq, Eq)]
pub struct CollectionDetail {
    #[serde(default)]
    pub collection_id: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub cover: String,
    #[serde(default)]
    pub background: String,
    #[serde(default)]
    pub release_year: String,
    #[serde(default)]
    pub video_type: String,
    #[serde(default)]
    pub score: Option<String>,
    #[serde(default)]
    pub rating: Option<String>,
    #[serde(default)]
    pub storyline: Option<String>,
    #[serde(default)]
    pub history: Option<PlaybackHistory>,
    #[serde(default)]
    pub seasons: Vec<Season>,
}

impl<'de> Deserialize<'de> for CollectionDetail {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let value = Value::deserialize(deserializer)?;
        parse_collection_detail(&value).map_err(D::Error::custom)
    }
}

impl CollectionDetail {
    /// Returns the effective score/rating string, if the NAS supplied one.
    pub fn display_score(&self) -> String {
        first_non_empty([self.score.as_deref(), self.rating.as_deref()])
            .unwrap_or_default()
            .to_string()
    }

    /// Returns a user-facing type label while retaining the raw NAS value.
    pub fn display_type(&self) -> &str {
        match self.video_type.to_ascii_lowercase().as_str() {
            "movie" | "film" | "100" => "电影",
            "tv" | "series" | "电视剧" => "剧集",
            "anime" | "动漫" => "动漫",
            "show" | "综艺" => "综艺",
            "diy" => "自建合集",
            _ => "影视",
        }
    }

    pub fn is_movie(&self) -> bool {
        matches!(
            self.video_type.to_ascii_lowercase().as_str(),
            "movie" | "film" | "100" | "电影"
        )
    }
}

fn parse_collection_detail(value: &Value) -> Result<CollectionDetail, String> {
    let object = value
        .as_object()
        .ok_or_else(|| "详情响应 data 必须是对象".to_string())?;

    let collection_id = first_string(object, &["collection_id", "id"]);
    let title = first_string(object, &["title", "name"]);
    let cover = first_string(object, &["cover", "poster", "cover_url", "cover_path"]);
    let background = first_string(
        object,
        &[
            "background",
            "backdrop",
            "background_image",
            "background_url",
            "bg",
        ],
    );
    let release_year = first_string(object, &["release_year", "year", "pub_year"]);
    let video_type = first_string(object, &["video_type", "type", "kind"]);
    let score = optional_string(object, &["score"]);
    let rating = optional_string(object, &["rating"]);
    let storyline = optional_string(object, &["storyline", "plot", "description", "intro"]);
    let history = object.get("history").and_then(parse_playback_history);

    let mut raw_episodes = Vec::new();
    if let Some(list) = object.get("list").and_then(Value::as_array) {
        for item in list {
            let Some(item_object) = item.as_object() else { continue };
            let season_number = first_u32(
                item_object,
                &["season", "season_number", "season_num", "season_index"],
            )
            .unwrap_or(1)
            .max(1);
            let season_title = first_string(item_object, &["season_name", "season_title"]);
            let mut found_nested = false;

            for key in ["version_list", "episodes", "episode_list", "video_list"] {
                if let Some(entries) = item_object.get(key).and_then(Value::as_array) {
                    found_nested = true;
                    for entry in entries {
                        if let Some(episode) = parse_episode(entry, season_number, &collection_id) {
                            raw_episodes.push((season_number, season_title.clone(), episode));
                        }
                    }
                }
            }

            if !found_nested {
                if let Some(episode) = parse_episode(item, season_number, &collection_id) {
                    raw_episodes.push((season_number, season_title, episode));
                }
            }
        }
    }

    for key in ["video_list", "episodes", "episode_list"] {
        if let Some(entries) = object.get(key).and_then(Value::as_array) {
            for entry in entries {
                if let Some(episode) = parse_episode(entry, 1, &collection_id) {
                    raw_episodes.push((1, String::new(), episode));
                }
            }
        }
    }

    let mut seasons = Vec::new();
    for (season_number, season_title, episode) in raw_episodes {
        let Some(existing) = seasons
            .iter_mut()
            .find(|season: &&mut Season| season.season_number == season_number)
        else {
            seasons.push(Season {
                season_number,
                title: if season_title.is_empty() {
                    format!("第{}季", season_number)
                } else {
                    season_title
                },
                episodes: Vec::new(),
            });
            let last = seasons.last_mut().expect("season was just inserted");
            last.episodes.push(episode);
            continue;
        };

        if existing.title.is_empty() || existing.title == format!("第{}季", season_number) {
            if !season_title.is_empty() {
                existing.title = season_title;
            }
        }
        let duplicate = existing.episodes.iter().any(|item| {
            (!episode.video_id.is_empty() && item.video_id == episode.video_id)
                || (!episode.file_path.is_empty() && item.file_path == episode.file_path)
        });
        if !duplicate {
            existing.episodes.push(episode);
        }
    }

    for season in &mut seasons {
        season
            .episodes
            .sort_by_key(|episode| episode.episode_number);
    }
    seasons.sort_by_key(|season| season.season_number);

    if seasons.is_empty() && is_movie_type(&video_type) {
        seasons.push(Season {
            season_number: 1,
            title: "正片".to_string(),
            episodes: vec![Episode {
                video_id: collection_id.clone(),
                episode_number: 1,
                title: if title.is_empty() { "正片".to_string() } else { title.clone() },
                ..Episode::default()
            }],
        });
    }

    Ok(CollectionDetail {
        collection_id,
        title,
        cover,
        background,
        release_year,
        video_type,
        score,
        rating,
        storyline,
        history,
        seasons,
    })
}

fn parse_episode(value: &Value, _parent_season: u32, collection_id: &str) -> Option<Episode> {
    let object = value.as_object()?;
    let video_id = first_string(object, &["video_id", "episode_id", "id"]);
    let file_path = first_string(object, &["file_path", "episode_path", "path", "url"]);
    let version_id = first_string(object, &["version_id"]);
    let encrypted_path = optional_string(object, &["encrypted_path"]);
    let from = optional_string(object, &["from"]);
    let has_episode_data = !video_id.is_empty()
        || !file_path.is_empty()
        || object.contains_key("episode")
        || object.contains_key("episode_number")
        || object.contains_key("episode_num");
    if !has_episode_data {
        return None;
    }

    let episode_number = first_u32(object, &["episode", "episode_number", "episode_num", "number"])
        .unwrap_or(1)
        .max(1);
    let title = first_string(object, &["title", "name", "episode_title", "episode_name", "version_name"]);
    let duration = optional_string(object, &["video_duration", "duration", "duration_sec"]);
    let stable_id = if video_id.is_empty() && version_id.is_empty() && file_path.is_empty() {
        format!("{}-{}", collection_id, episode_number)
    } else {
        video_id.clone()
    };

    Some(Episode {
        video_id: stable_id,
        episode_number,
        title: if title.is_empty() {
            format!("第{}集", episode_number)
        } else {
            title
        },
        file_path,
        version_id,
        duration,
        encrypted_path,
        from,
    })
}

fn first_string(object: &serde_json::Map<String, Value>, keys: &[&str]) -> String {
    keys.iter()
        .find_map(|key| object.get(*key).and_then(value_as_string).filter(|value| !value.is_empty()))
        .unwrap_or_default()
}

fn optional_string(object: &serde_json::Map<String, Value>, keys: &[&str]) -> Option<String> {
    let value = first_string(object, keys);
    if value.is_empty() { None } else { Some(value) }
}

fn parse_playback_history(value: &Value) -> Option<PlaybackHistory> {
    serde_json::from_value(value.clone()).ok()
}

fn first_non_empty<'a>(values: impl IntoIterator<Item = Option<&'a str>>) -> Option<&'a str> {
    values.into_iter().flatten().find(|value| !value.is_empty())
}

fn value_as_string(value: &Value) -> Option<String> {
    match value {
        Value::String(value) => Some(value.clone()),
        Value::Number(value) => Some(value.to_string()),
        Value::Bool(value) => Some(value.to_string()),
        _ => None,
    }
}

fn deserialize_string_value<'de, D>(deserializer: D) -> Result<String, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let value = Value::deserialize(deserializer)?;
    Ok(value_as_string(&value).unwrap_or_default())
}

fn deserialize_optional_string<'de, D>(deserializer: D) -> Result<Option<String>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let value = Option::<Value>::deserialize(deserializer)?;
    Ok(value.and_then(|value| value_as_string(&value)))
}

fn deserialize_optional_i64<'de, D>(deserializer: D) -> Result<Option<i64>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let value = Option::<Value>::deserialize(deserializer)?;
    Ok(value.and_then(|value| value_as_i64(&value)))
}

fn first_u32(object: &serde_json::Map<String, Value>, keys: &[&str]) -> Option<u32> {
    keys.iter().find_map(|key| object.get(*key).and_then(value_as_u32))
}

fn value_as_u32(value: &Value) -> Option<u32> {
    match value {
        Value::Number(value) => value
            .as_u64()
            .and_then(|value| u32::try_from(value).ok())
            .or_else(|| value.as_f64().map(|value| value as u32)),
        Value::String(value) => value.trim().parse().ok(),
        _ => None,
    }
}

fn value_as_i64(value: &Value) -> Option<i64> {
    match value {
        Value::Number(value) => value
            .as_i64()
            .or_else(|| value.as_u64().and_then(|value| i64::try_from(value).ok()))
            .or_else(|| value.as_f64().and_then(float_as_i64)),
        Value::String(value) => value
            .trim()
            .parse()
            .ok()
            .or_else(|| value.trim().parse::<f64>().ok().and_then(float_as_i64)),
        _ => None,
    }
}

fn float_as_i64(value: f64) -> Option<i64> {
    (value.is_finite()
        && value.fract() == 0.0
        && value >= i64::MIN as f64
        && value <= i64::MAX as f64)
        .then_some(value as i64)
}

fn is_movie_type(video_type: &str) -> bool {
    matches!(video_type.to_ascii_lowercase().as_str(), "movie" | "film" | "100" | "电影")
}

/// Paginated collection list response data from `POST /zvideo/video/v2/list`.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct CollectionPage {
    #[serde(default, alias = "collection_count", alias = "collectionCount")]
    pub count: usize,
    #[serde(default)]
    pub classification_name: Option<String>,
    #[serde(default)]
    pub list: Vec<CollectionItem>,
}

/// Unified error types encountered during NAS API calls and library operations.
#[derive(Debug, Error)]
pub enum NasError {
    #[error("用户未认证或会话已过期，请重新登录")]
    Unauthorized,

    #[error("网络通信失败，请检查网络连接: {0}")]
    Network(String),

    #[error("HTTP 服务请求异常 (状态码 {status}): {message}")]
    Http { status: u16, message: String },

    #[error("NAS 业务响应错误 (错误码 {code}): {message}")]
    Business { code: String, message: String },

    #[error("解析 NAS 数据结构失败: {0}")]
    MalformedResponse(String),

    #[error("认证模块异常: {0}")]
    Auth(#[from] AuthError),
}

impl NasError {
    /// Generates clear, non-technical instructions for user interface display.
    pub fn user_recovery_hint(&self) -> String {
        match self {
            NasError::Unauthorized => "登录凭据已过期或失效，请退出并重新登录。".to_string(),
            NasError::Network(msg) => {
                format!("无法连接 NAS 片库服务: {}", sanitize_log_message(msg))
            }
            NasError::Http { status, message } => {
                format!(
                    "HTTP 请求失败 ({})，请核对 NAS 状态: {}",
                    status,
                    sanitize_log_message(message)
                )
            }
            NasError::Business { code, message } => {
                format!("片库服务提示 ({})：{}", code, sanitize_log_message(message))
            }
            NasError::MalformedResponse(msg) => {
                format!("片库数据返回格式异常: {}", sanitize_log_message(msg))
            }
            NasError::Auth(auth_err) => auth_err.user_recovery_hint(),
        }
    }

    pub fn requires_reauthentication(&self) -> bool {
        matches!(self, NasError::Unauthorized | NasError::Auth(_))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_classification_visibility_filter() {
        let sys_enabled = ClassificationItem {
            id: "1".to_string(),
            name: "电影".to_string(),
            is_system: 1,
            is_enable: 1,
            count: 10,
        };
        assert!(sys_enabled.is_visible());

        let sys_disabled = ClassificationItem {
            id: "2".to_string(),
            name: "电视剧".to_string(),
            is_system: 1,
            is_enable: 0,
            count: 5,
        };
        assert!(!sys_disabled.is_visible());

        let custom_category = ClassificationItem {
            id: "100".to_string(),
            name: "私人珍藏".to_string(),
            is_system: 0,
            is_enable: 0,
            count: 12,
        };
        assert!(custom_category.is_visible());
    }

    #[test]
    fn test_deserialize_classification_response() {
        let json_str = r#"[
            {"id": "1", "name": "电影", "is_system": 1, "is_enable": 1, "count": 42},
            {"id": "2", "name": "电视剧", "is_system": 1, "is_enable": 0, "count": 18},
            {"id": "10", "name": "动漫", "is_system": 0, "count": 8}
        ]"#;

        let items: Vec<ClassificationItem> = serde_json::from_str(json_str).unwrap();
        assert_eq!(items.len(), 3);
        assert_eq!(items[0].name, "电影");
        assert_eq!(items[0].count, 42);
        assert!(items[0].is_visible());
        assert!(!items[1].is_visible());
        assert!(items[2].is_visible());
    }

    #[test]
    fn test_deserialize_collection_page() {
        let json_str = r#"{
            "count": 2,
            "classification_name": "电影",
            "list": [
                {
                    "collection_id": "c101",
                    "title": "肖申克的救赎",
                    "cover": "/zvideo/cover/shawshank.jpg",
                    "release_year": 1994,
                    "video_type": "movie",
                    "score": 9.7
                },
                {
                    "collection_id": "c102",
                    "title": "星际穿越",
                    "cover": "/zvideo/cover/interstellar.jpg",
                    "release_year": "2014",
                    "video_type": "movie",
                    "rating": "9.4"
                }
            ]
        }"#;

        let page: CollectionPage = serde_json::from_str(json_str).unwrap();
        assert_eq!(page.count, 2);
        assert_eq!(page.classification_name, Some("电影".to_string()));
        assert_eq!(page.list.len(), 2);
        assert_eq!(page.list[0].display_score(), "9.7");
        assert_eq!(page.list[0].display_type(), "电影");
        assert_eq!(page.list[1].display_score(), "9.4");
    }

    #[test]
    fn collection_detail_parses_movie_and_multi_season_episode_data() {
        let json = r#"{
            "collection_id": "series-01",
            "title": "测试剧集",
            "cover": "/zvideo/cover/series.jpg",
            "background": "/zvideo/background/series.jpg",
            "release_year": 2024,
            "type": "tv",
            "score": 8.8,
            "storyline": "一段测试剧情。",
            "list": [
                {
                    "season": 1,
                    "season_name": "第一季",
                    "version_list": [
                        {"video_id": "s1e1", "episode": 1, "title": "开端", "file_path": "/media/s1e1.mkv"},
                        {"video_id": "s1e2", "episode": 2, "title": "发展", "file_path": "/media/s1e2.mkv"}
                    ]
                },
                {
                    "season": 2,
                    "season_name": "第二季",
                    "version_list": [
                        {"video_id": "s2e1", "episode": 1, "title": "新的开始", "file_path": "/media/s2e1.mkv"}
                    ]
                }
            ]
        }"#;

        let detail: CollectionDetail = serde_json::from_str(json).expect("detail should parse");
        assert_eq!(detail.collection_id, "series-01");
        assert_eq!(detail.background, "/zvideo/background/series.jpg");
        assert_eq!(detail.release_year, "2024");
        assert_eq!(detail.display_score(), "8.8");
        assert_eq!(detail.seasons.len(), 2);
        assert_eq!(detail.seasons[0].season_number, 1);
        assert_eq!(detail.seasons[0].title, "第一季");
        assert_eq!(detail.seasons[0].episodes[1].episode_number, 2);
        assert_eq!(detail.seasons[1].episodes[0].video_id, "s2e1");

        let sparse: CollectionDetail = serde_json::from_str(
            r#"{"collection_id":"movie-01","title":"只有标题","type":"movie"}"#,
        )
        .expect("missing optional detail fields should be safe");
        assert_eq!(sparse.release_year, "");
        assert_eq!(sparse.storyline, None);
        assert_eq!(sparse.seasons.len(), 1);
        assert_eq!(sparse.seasons[0].episodes.len(), 1);
        assert_eq!(sparse.seasons[0].episodes[0].episode_number, 1);
    }

    #[test]
    fn playback_history_parses_detail_history_with_numeric_and_string_values() {
        let detail_data: Value = serde_json::from_str(
            r#"{
                "collection_id": "safe-collection",
                "title": "测试详情",
                "type": "tv",
                "history": {
                    "last_video_id": 12345,
                    "play_duration": "42",
                    "audio_index": "1",
                    "subtitle_index": 2,
                    "subtitle_hash": "fixture-hash",
                    "subtitle_setting": "default",
                    "play_chapter": "3"
                }
            }"#,
        )
        .expect("detail data fixture should parse");

        let detail: CollectionDetail = serde_json::from_value(detail_data)
            .expect("detail history should accept numeric and string values");
        let history = detail.history.expect("history should be present");
        assert_eq!(history.last_video_id.as_deref(), Some("12345"));
        assert_eq!(history.play_duration, Some(42));
        assert_eq!(history.audio_index, Some(1));
        assert_eq!(history.subtitle_index, Some(2));
        assert_eq!(history.subtitle_hash.as_deref(), Some("fixture-hash"));
        assert_eq!(history.subtitle_setting.as_deref(), Some("default"));
        assert_eq!(history.play_chapter, Some(3));
    }

    #[test]
    fn playback_history_keeps_missing_detail_history_optional() {
        let detail_data: Value = serde_json::from_str(
            r#"{"collection_id":"without-history","title":"无历史记录","type":"movie"}"#,
        )
        .expect("detail data fixture should parse");

        let detail: CollectionDetail = serde_json::from_value(detail_data)
            .expect("missing history should not make detail parsing fail");

        assert_eq!(detail.history, None);
    }
}
