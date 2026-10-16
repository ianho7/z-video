use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::nas::auth::AuthError;

/// Classification category item returned by `POST /zvideo/classification/list`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ClassificationItem {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub is_system: i32,
    #[serde(default)]
    pub is_enable: i32,
    #[serde(default)]
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
    #[serde(default)]
    pub cover: String,
    #[serde(default)]
    pub release_year: String,
    #[serde(default)]
    pub video_type: String,
    #[serde(default)]
    pub score: Option<String>,
    #[serde(default)]
    pub rating: Option<String>,
    #[serde(default)]
    pub episode_count: Option<i32>,
    #[serde(default)]
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

/// Paginated collection list response data from `POST /zvideo/video/v2/list`.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct CollectionPage {
    #[serde(default)]
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
            NasError::Network(msg) => format!("无法连接 NAS 片库服务: {}", msg),
            NasError::Http { status, message } => {
                format!("HTTP 请求失败 ({})，请核对 NAS 状态: {}", status, message)
            }
            NasError::Business { code, message } => {
                format!("片库服务提示 ({})：{}", code, message)
            }
            NasError::MalformedResponse(msg) => {
                format!("片库数据返回格式异常: {}", msg)
            }
            NasError::Auth(auth_err) => auth_err.user_recovery_hint(),
        }
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
                    "release_year": "1994",
                    "video_type": "movie",
                    "score": "9.7"
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
}
