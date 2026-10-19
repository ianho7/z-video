use slint::{ComponentHandle, LogicalSize, ModelRc, Timer, VecModel};
use std::env;
use std::path::PathBuf;
use std::rc::Rc;
use std::sync::Arc;
use std::time::Duration;
use z_video::app::{
    AppCoordinator, ClassificationUiItem, CollectionUiItem, EpisodeUiItem, SeasonUiItem,
};
use z_video::media::image_cache::{slint_image_from_decoded, DecodedImage};
use z_video::nas::client::MockNasClient;
use z_video::player::MockPlayer;
use z_video::storage::credentials::MemoryCredentialStore;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let (
        width,
        height,
        output,
        hold_ms,
        view,
        detail_state,
        media_type,
        sort_order,
        detail_roundtrip,
        detail_output,
        back_output,
        material_evidence,
    ) = parse_args()?;
    let coordinator = AppCoordinator::with_deps(
        Arc::new(MockPlayer::new()),
        false,
        Arc::new(MockNasClient::new()),
        Arc::new(MemoryCredentialStore::new()),
    )?;
    if detail_roundtrip {
        coordinator.perform_login(
            "http://192.168.1.50:5055",
            "admin",
            "password123",
            None,
            false,
        )?;
        coordinator.load_collections_sync("1")?;
    }
    let window = coordinator.window().clone_strong();

    window.set_is_logged_in(true);
    window.set_current_view("library".into());
    window.set_apple_sidebar_visible(true);
    window.set_material_evidence(material_evidence);
    window.set_session_user("fixture-user".into());
    window.set_session_nas_name("脱敏 NAS".into());
    window.set_selected_classification_id("fixture-classification".into());
    window.set_selected_classification_name("脱敏海报墙".into());
    let collections = preview_collections(&media_type, &sort_order);
    let result_count = collections.len();
    window.set_collection_count(result_count as i32);
    window.set_media_type_filter(media_type.clone().into());
    window.set_sort_order(sort_order.clone().into());
    window.set_search_active(media_type != "all" || sort_order != "default");
    window.set_search_scope(
        if media_type == "all" && sort_order == "default" {
            "当前已加载范围：9 部".to_string()
        } else {
            format!(
                "仅当前已加载 9 部 · 类型：{} · 排序：{} · 匹配 {} 部",
                media_type_label(&media_type),
                sort_order_label(&sort_order),
                result_count
            )
        }
        .into(),
    );
    window.set_classifications(ModelRc::from(Rc::new(VecModel::from(vec![
        ClassificationUiItem {
            id: "fixture-classification".into(),
            name: "脱敏海报墙".into(),
            count: 9,
            is_selected: true,
        },
    ]))));
    window.set_collections(ModelRc::from(Rc::new(
        VecModel::from(collections),
    )));
    if view == "detail" {
        configure_detail_fixture(&window, &detail_state);
    }

    window
        .window()
        .set_size(LogicalSize::new(width as f32, height as f32));
    window.show()?;

    let output_for_timer = output.clone();
    Timer::single_shot(Duration::from_millis(600), move || {
        let dimensions = match window.window().take_snapshot() {
            Ok(snapshot) => match save_snapshot(&snapshot, &output_for_timer) {
                Ok(dimensions) => dimensions,
                Err(error) => {
                    eprintln!("poster preview snapshot failed: {error}");
                    std::process::exit(1);
                }
            },
            Err(error) => {
                eprintln!("poster preview snapshot failed: {error}");
                std::process::exit(1);
            }
        };
        eprintln!(
            "poster preview saved: {} logical={}x{} png={}x{}",
            output_for_timer.display(),
            width,
            height,
            dimensions.0,
            dimensions.1
        );
        if detail_roundtrip {
            let detail_output = detail_output.clone();
            let back_output = back_output.clone();
            let detail_window = window.clone_strong();
            detail_window.invoke_collection_clicked("c04".into());
            Timer::single_shot(Duration::from_millis(700), move || {
                let dimensions = match detail_window.window().take_snapshot() {
                    Ok(snapshot) => match save_snapshot(&snapshot, &detail_output) {
                        Ok(dimensions) => dimensions,
                        Err(error) => {
                            eprintln!("detail preview snapshot failed: {error}");
                            std::process::exit(1);
                        }
                    },
                    Err(error) => {
                        eprintln!("detail preview snapshot failed: {error}");
                        std::process::exit(1);
                    }
                };
                eprintln!(
                    "detail preview saved: {} logical={}x{} png={}x{}",
                    detail_output.display(),
                    width,
                    height,
                    dimensions.0,
                    dimensions.1
                );
                let back_window = detail_window.clone_strong();
                back_window.invoke_detail_back_clicked();
                Timer::single_shot(Duration::from_millis(350), move || {
                    let dimensions = match back_window.window().take_snapshot() {
                        Ok(snapshot) => match save_snapshot(&snapshot, &back_output) {
                            Ok(dimensions) => dimensions,
                            Err(error) => {
                                eprintln!("back preview snapshot failed: {error}");
                                std::process::exit(1);
                            }
                        },
                        Err(error) => {
                            eprintln!("back preview snapshot failed: {error}");
                            std::process::exit(1);
                        }
                    };
                    eprintln!(
                        "back preview saved: {} logical={}x{} png={}x{}",
                        back_output.display(),
                        width,
                        height,
                        dimensions.0,
                        dimensions.1
                    );
                    if hold_ms <= 1_650 {
                        let _ = slint::quit_event_loop();
                    } else {
                        Timer::single_shot(Duration::from_millis(hold_ms - 1_650), || {
                            let _ = slint::quit_event_loop();
                        });
                    }
                });
            });
        } else if hold_ms <= 600 {
            let _ = slint::quit_event_loop();
        } else {
            Timer::single_shot(Duration::from_millis(hold_ms - 600), || {
                let _ = slint::quit_event_loop();
            });
        }
    });

    slint::run_event_loop_until_quit()?;
    Ok(())
}

fn parse_args() -> Result<
    (u32, u32, PathBuf, u64, String, String, String, String, bool, PathBuf, PathBuf, bool),
    Box<dyn std::error::Error>,
> {
    let args: Vec<String> = env::args().collect();
    let mut width = 1440;
    let mut height = 900;
    let mut output = PathBuf::from("poster-grid-preview.png");
    let mut hold_ms = 600;
    let mut view = "library".to_string();
    let mut detail_state = "complete".to_string();
    let mut media_type = "all".to_string();
    let mut sort_order = "default".to_string();
    let mut detail_roundtrip = false;
    let mut detail_output = PathBuf::from("poster-grid-detail.png");
    let mut back_output = PathBuf::from("poster-grid-back.png");
    let mut material_evidence = false;
    let mut index = 1;
    while index < args.len() {
        match args[index].as_str() {
            "--width" => {
                index += 1;
                width = args.get(index).ok_or("--width requires a value")?.parse()?;
            }
            "--height" => {
                index += 1;
                height = args
                    .get(index)
                    .ok_or("--height requires a value")?
                    .parse()?;
            }
            "--output" => {
                index += 1;
                output = PathBuf::from(args.get(index).ok_or("--output requires a path")?);
            }
            "--hold-ms" => {
                index += 1;
                hold_ms = args
                    .get(index)
                    .ok_or("--hold-ms requires a value")?
                    .parse()?;
            }
            "--view" => {
                index += 1;
                view = args.get(index).ok_or("--view requires a value")?.clone();
            }
            "--detail-state" => {
                index += 1;
                detail_state = args
                    .get(index)
                    .ok_or("--detail-state requires a value")?
                    .clone();
            }
            "--media-type" => {
                index += 1;
                media_type = args
                    .get(index)
                    .ok_or("--media-type requires a value")?
                    .to_string();
            }
            "--sort-order" => {
                index += 1;
                sort_order = args
                    .get(index)
                    .ok_or("--sort-order requires a value")?
                    .to_string();
            }
            "--detail-roundtrip" => detail_roundtrip = true,
            "--material-evidence" => material_evidence = true,
            "--detail-output" => {
                index += 1;
                detail_output =
                    PathBuf::from(args.get(index).ok_or("--detail-output requires a path")?);
            }
            "--back-output" => {
                index += 1;
                back_output =
                    PathBuf::from(args.get(index).ok_or("--back-output requires a path")?);
            }
            value => return Err(format!("unknown argument: {value}").into()),
        }
        index += 1;
    }
    if width == 0 || height == 0 {
        return Err("preview dimensions must be positive".into());
    }
    if !matches!(view.as_str(), "library" | "detail") {
        return Err("--view must be library or detail".into());
    }
    if !matches!(detail_state.as_str(), "complete" | "missing-cover" | "empty-episodes" | "error")
    {
        return Err(
            "--detail-state must be complete, missing-cover, empty-episodes, or error".into(),
        );
    }
    Ok((
        width,
        height,
        output,
        hold_ms,
        view,
        detail_state,
        media_type,
        sort_order,
        detail_roundtrip,
        detail_output,
        back_output,
        material_evidence,
    ))
}

fn configure_detail_fixture(window: &z_video::app::AppWindow, state: &str) {
    window.set_current_view("detail".into());
    window.set_detail_title("脱敏剧集 · 夜航样本".into());
    window.set_detail_release_year("2024".into());
    window.set_detail_video_type("电视剧".into());
    window.set_detail_score("8.8".into());
    window.set_detail_storyline(
        "一组脱敏角色在沿海城市寻找失落的档案，旅途中逐步拼出一段关于家庭与选择的记忆。"
            .into(),
    );
    window.set_detail_loading(false);
    window.set_playback_loading(false);
    window.set_playback_error("".into());

    match state {
        "error" => {
            window.set_detail_has_cover(false);
            window.set_detail_seasons(ModelRc::from(Rc::new(VecModel::from(Vec::<SeasonUiItem>::new()))));
            window.set_selected_episode_id("".into());
            window.set_detail_error("fixture：详情服务暂时不可用，请稍后重试".into());
        }
        "missing-cover" => {
            window.set_detail_has_cover(false);
            window.set_detail_cover_image(slint::Image::default());
            window.set_detail_error("".into());
            set_fixture_seasons(window, true);
        }
        "empty-episodes" => {
            window.set_detail_has_cover(true);
            window.set_detail_cover_image(fixture_image(600, 900, [44, 74, 112, 255], [110, 160, 190, 255]));
            window.set_detail_error("".into());
            window.set_detail_seasons(ModelRc::from(Rc::new(VecModel::from(Vec::<SeasonUiItem>::new()))));
            window.set_selected_episode_id("".into());
        }
        _ => {
            window.set_detail_has_cover(true);
            window.set_detail_cover_image(fixture_image(600, 900, [44, 74, 112, 255], [110, 160, 190, 255]));
            window.set_detail_error("".into());
            set_fixture_seasons(window, true);
        }
    }
}

fn set_fixture_seasons(window: &z_video::app::AppWindow, include_second_season: bool) {
    let first_season = SeasonUiItem {
        season_number: 1,
        title: "第一季 · 6 集".into(),
        episodes: ModelRc::from(Rc::new(VecModel::from(vec![
            EpisodeUiItem {
                episode_id: "fixture-s1e1".into(),
                episode_number: 1,
                title: "潮汐线".into(),
                duration: "45 分钟".into(),
                is_selected: true,
            },
            EpisodeUiItem {
                episode_id: "fixture-s1e2".into(),
                episode_number: 2,
                title: "回声室".into(),
                duration: "47 分钟".into(),
                is_selected: false,
            },
        ]))),
    };
    let mut seasons = vec![first_season];
    if include_second_season {
        seasons.push(SeasonUiItem {
            season_number: 2,
            title: "第二季 · 4 集".into(),
            episodes: ModelRc::from(Rc::new(VecModel::from(vec![EpisodeUiItem {
                episode_id: "fixture-s2e1".into(),
                episode_number: 1,
                title: "远岸".into(),
                duration: "49 分钟".into(),
                is_selected: false,
            }]))),
        });
    }
    window.set_detail_seasons(ModelRc::from(Rc::new(VecModel::from(seasons))));
    window.set_selected_episode_id("fixture-s1e1".into());
}

fn media_type_label(media_type: &str) -> &'static str {
    match media_type {
        "all" => "全部类型",
        "movie" => "电影",
        "tv" => "剧集",
        _ => "未知类型",
    }
}

fn sort_order_label(sort_order: &str) -> &'static str {
    match sort_order {
        "default" => "默认顺序",
        "title_asc" => "片名 A-Z",
        "score_desc" => "评分高到低",
        "release_year_desc" => "上映年份新到旧",
        _ => "未知排序",
    }
}

fn preview_collections(media_type: &str, sort_order: &str) -> Vec<CollectionUiItem> {
    let mut collections: Vec<CollectionUiItem> = fixture_collections()
        .into_iter()
        .filter(|item| match media_type {
            "movie" => item.video_type == "电影",
            "tv" => item.video_type == "电视剧",
            _ => true,
        })
        .collect();

    match sort_order {
        "title_asc" => collections.sort_by(|left, right| {
            left.title
                .to_lowercase()
                .cmp(&right.title.to_lowercase())
        }),
        "score_desc" => collections.sort_by(|left, right| {
            right
                .score
                .parse::<f32>()
                .ok()
                .partial_cmp(&left.score.parse::<f32>().ok())
                .unwrap_or(std::cmp::Ordering::Equal)
        }),
        "release_year_desc" => collections.sort_by(|left, right| {
            right.release_year.cmp(&left.release_year)
        }),
        _ => {}
    }

    collections
}

fn fixture_collections() -> Vec<CollectionUiItem> {
    vec![
        CollectionUiItem {
            collection_id: "fixture-horizontal".into(),
            title: "横图封面".into(),
            release_year: "2026".into(),
            video_type: "电影".into(),
            score: "8.6".into(),
            cover_image: fixture_image(640, 360, [35, 95, 165, 255], [220, 170, 55, 255]),
            has_cover: true,
            cover_status: "ready".into(),
        },
        CollectionUiItem {
            collection_id: "fixture-vertical".into(),
            title: "竖图封面".into(),
            release_year: "2025".into(),
            video_type: "电视剧".into(),
            score: "9.1".into(),
            cover_image: fixture_image(360, 640, [130, 48, 94, 255], [80, 200, 170, 255]),
            has_cover: true,
            cover_status: "ready".into(),
        },
        CollectionUiItem {
            collection_id: "fixture-ultra-wide".into(),
            title: "超宽源图封面".into(),
            release_year: "2024".into(),
            video_type: "电影".into(),
            score: "7.8".into(),
            cover_image: fixture_image(1200, 180, [188, 70, 40, 255], [240, 210, 70, 255]),
            has_cover: true,
            cover_status: "ready".into(),
        },
        CollectionUiItem {
            collection_id: "fixture-long-title".into(),
            title: "一个非常长的脱敏片名用于验证标题省略不会改变卡片宽度".into(),
            release_year: "2023".into(),
            video_type: "纪录片".into(),
            score: "8.2".into(),
            cover_image: fixture_image(512, 512, [68, 120, 72, 255], [210, 80, 150, 255]),
            has_cover: true,
            cover_status: "ready".into(),
        },
        CollectionUiItem {
            collection_id: "fixture-missing-cover".into(),
            title: "缺失封面占位".into(),
            release_year: "2022".into(),
            video_type: "动画".into(),
            score: "".into(),
            cover_image: slint::Image::default(),
            has_cover: false,
            cover_status: "missing".into(),
        },
        CollectionUiItem {
            collection_id: "fixture-horizontal-2".into(),
            title: "第二张横图".into(),
            release_year: "2021".into(),
            video_type: "电影".into(),
            score: "8.0".into(),
            cover_image: fixture_image(900, 420, [68, 78, 150, 255], [180, 220, 80, 255]),
            has_cover: true,
            cover_status: "ready".into(),
        },
        CollectionUiItem {
            collection_id: "fixture-vertical-2".into(),
            title: "第二张竖图".into(),
            release_year: "2020".into(),
            video_type: "电视剧".into(),
            score: "7.9".into(),
            cover_image: fixture_image(300, 700, [170, 84, 40, 255], [50, 180, 230, 255]),
            has_cover: true,
            cover_status: "ready".into(),
        },
        CollectionUiItem {
            collection_id: "fixture-failure-cover".into(),
            title: "失败封面占位".into(),
            release_year: "2019".into(),
            video_type: "电影".into(),
            score: "".into(),
            cover_image: slint::Image::default(),
            has_cover: false,
            cover_status: "failed".into(),
        },
        CollectionUiItem {
            collection_id: "fixture-loading-cover".into(),
            title: "加载中封面占位".into(),
            release_year: "2018".into(),
            video_type: "电影".into(),
            score: "".into(),
            cover_image: slint::Image::default(),
            has_cover: false,
            cover_status: "loading".into(),
        },
    ]
}

fn fixture_image(width: u32, height: u32, base: [u8; 4], accent: [u8; 4]) -> slint::Image {
    let mut rgba = vec![0; width as usize * height as usize * 4];
    for y in 0..height {
        for x in 0..width {
            let stripe = ((x * 7 / width.max(1)) + (y * 5 / height.max(1))) % 2 == 0;
            let color = if stripe { base } else { accent };
            let offset = ((y * width + x) * 4) as usize;
            rgba[offset..offset + 4].copy_from_slice(&color);
        }
    }
    slint_image_from_decoded(DecodedImage {
        width,
        height,
        rgba,
    })
}

fn save_snapshot(
    snapshot: &slint::SharedPixelBuffer<slint::Rgba8Pixel>,
    output: &PathBuf,
) -> Result<(u32, u32), Box<dyn std::error::Error>> {
    if let Some(parent) = output
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
    {
        std::fs::create_dir_all(parent)?;
    }
    let image = image::RgbaImage::from_raw(
        snapshot.width(),
        snapshot.height(),
        snapshot.as_bytes().to_vec(),
    )
    .ok_or("snapshot buffer dimensions do not match pixel data")?;
    image.save(output)?;
    Ok((snapshot.width(), snapshot.height()))
}
