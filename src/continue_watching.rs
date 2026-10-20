//! Local "continue watching" projection.
//!
//! The NAS does not expose a trusted aggregate history endpoint in the
//! client contract.  This module deliberately accepts one locally persisted
//! playback context and one already supported collection detail response,
//! then projects only the matching episode and its real history.

use crate::nas::models::{CollectionDetail, Episode};
use crate::storage::credentials::LastPlaybackContext;

/// A display-ready projection of one locally known recent playback item.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ContinueWatchingItem {
    pub collection_id: String,
    pub classification_id: String,
    pub episode_id: String,
    pub title: String,
    pub episode_title: String,
    pub cover: String,
    pub watched_seconds: u64,
    pub duration_seconds: Option<u64>,
    pub progress_percent: Option<u32>,
    pub progress_label: String,
    pub duration_label: String,
}

/// Build a continue-watching item from a persisted local context and real
/// collection detail history.
///
/// A missing history, a non-positive watch position, or a history entry for a
/// different episode is intentionally hidden.  The single-episode fallback
/// mirrors the existing playback coordinator: some NAS responses omit a
/// stable video id for a movie, while the detail response still proves that
/// there is exactly one playable episode.
pub fn build_continue_watching_item(
    context: &LastPlaybackContext,
    detail: &CollectionDetail,
) -> Option<ContinueWatchingItem> {
    let collection_id = context.collection_id.trim();
    let classification_id = context.classification_id.trim();
    let episode_id = context.episode_id.trim();

    if collection_id.is_empty() || classification_id.is_empty() || episode_id.is_empty() {
        return None;
    }
    if !detail.collection_id.trim().is_empty() && detail.collection_id.trim() != collection_id {
        return None;
    }

    let episodes: Vec<&Episode> = detail
        .seasons
        .iter()
        .flat_map(|season| season.episodes.iter())
        .collect();
    let episode = episodes
        .iter()
        .copied()
        .find(|candidate| episode_matches(candidate, episode_id))?;
    let history = detail.history.as_ref()?;
    let watched_seconds = u64::try_from(history.play_duration?).ok()?;
    if watched_seconds == 0 {
        return None;
    }

    if let Some(history_episode_id) = history.last_video_id.as_deref().map(str::trim) {
        if !history_episode_id.is_empty()
            && !episode_matches(episode, history_episode_id)
            && episodes.len() != 1
        {
            return None;
        }
    }

    let duration_seconds = episode.duration.as_deref().and_then(parse_duration_seconds);
    let progress_percent = duration_seconds.map(|duration| {
        let numerator = u128::from(watched_seconds).saturating_mul(100);
        let percent = numerator / u128::from(duration);
        u32::try_from(percent.min(100)).unwrap_or(100)
    });

    let title = if detail.title.trim().is_empty() {
        "未命名影视".to_string()
    } else {
        detail.title.trim().to_string()
    };
    let episode_title = if episode.title.trim().is_empty() {
        if episode.episode_number > 0 {
            format!("第{}集", episode.episode_number)
        } else {
            "继续观看".to_string()
        }
    } else {
        episode.title.trim().to_string()
    };

    Some(ContinueWatchingItem {
        collection_id: collection_id.to_string(),
        classification_id: classification_id.to_string(),
        episode_id: episode.selection_id().to_string(),
        title,
        episode_title,
        cover: detail.cover.trim().to_string(),
        watched_seconds,
        duration_seconds,
        progress_percent,
        progress_label: match progress_percent {
            Some(percent) => format!("已看 {}%", percent),
            None => format!("已看 {}", format_watch_time(watched_seconds)),
        },
        duration_label: duration_seconds
            .map(format_watch_time)
            .unwrap_or_else(|| "时长未知".to_string()),
    })
}

fn episode_matches(episode: &Episode, expected_id: &str) -> bool {
    let expected_id = expected_id.trim();
    !expected_id.is_empty()
        && [
            episode.video_id.as_str(),
            episode.version_id.as_str(),
            episode.file_path.as_str(),
            episode.selection_id(),
        ]
        .iter()
        .any(|candidate| !candidate.trim().is_empty() && candidate.trim() == expected_id)
}

fn parse_duration_seconds(raw: &str) -> Option<u64> {
    let raw = raw.trim();
    if raw.is_empty() {
        return None;
    }

    if raw.contains(':') {
        let parts: Vec<&str> = raw.split(':').collect();
        if !(2..=3).contains(&parts.len()) || parts.iter().any(|part| part.trim().is_empty()) {
            return None;
        }
        let numbers: Vec<u64> = parts
            .iter()
            .map(|part| part.trim().parse::<u64>().ok())
            .collect::<Option<Vec<_>>>()?;
        let seconds = if numbers.len() == 3 {
            if numbers[1] >= 60 || numbers[2] >= 60 {
                return None;
            }
            u128::from(numbers[0]) * 3600 + u128::from(numbers[1]) * 60 + u128::from(numbers[2])
        } else {
            if numbers[1] >= 60 {
                return None;
            }
            u128::from(numbers[0]) * 60 + u128::from(numbers[1])
        };
        return u64::try_from(seconds).ok().filter(|seconds| *seconds > 0);
    }

    if let Ok(seconds) = raw.parse::<u64>() {
        return (seconds > 0).then_some(seconds);
    }

    let mut total = 0.0_f64;
    let mut number = String::new();
    let mut saw_unit = false;
    for character in raw.chars() {
        if character.is_ascii_digit() || character == '.' {
            number.push(character);
            continue;
        }

        let multiplier = match character.to_ascii_lowercase() {
            'h' => 3600.0,
            'm' => 60.0,
            's' => 1.0,
            _ => return None,
        };
        let value = number.parse::<f64>().ok()?;
        if !value.is_finite() || value < 0.0 {
            return None;
        }
        total += value * multiplier;
        number.clear();
        saw_unit = true;
    }
    if !number.is_empty() || !saw_unit || !total.is_finite() || total <= 0.0 {
        return None;
    }
    Some(total.round() as u64)
}

fn format_watch_time(seconds: u64) -> String {
    let hours = seconds / 3600;
    let minutes = (seconds % 3600) / 60;
    let seconds = seconds % 60;
    if hours > 0 {
        format!("{:02}:{:02}:{:02}", hours, minutes, seconds)
    } else {
        format!("{:02}:{:02}", minutes, seconds)
    }
}

#[cfg(test)]
mod tests {
    use super::parse_duration_seconds;

    #[test]
    fn parses_supported_duration_shapes() {
        assert_eq!(parse_duration_seconds("169m"), Some(10_140));
        assert_eq!(parse_duration_seconds("01:02:03"), Some(3_723));
        assert_eq!(parse_duration_seconds("02:30"), Some(150));
        assert_eq!(parse_duration_seconds("0"), None);
        assert_eq!(parse_duration_seconds("unknown"), None);
    }
}
