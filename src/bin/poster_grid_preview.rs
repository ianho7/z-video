use slint::{ComponentHandle, LogicalSize, ModelRc, Timer, VecModel};
use std::env;
use std::path::PathBuf;
use std::rc::Rc;
use std::sync::Arc;
use std::time::Duration;
use z_video::app::{AppCoordinator, ClassificationUiItem, CollectionUiItem};
use z_video::media::image_cache::{slint_image_from_decoded, DecodedImage};
use z_video::nas::client::MockNasClient;
use z_video::player::MockPlayer;
use z_video::storage::credentials::MemoryCredentialStore;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let (width, height, output, hold_ms) = parse_args()?;
    let coordinator = AppCoordinator::with_deps(
        Arc::new(MockPlayer::new()),
        false,
        Arc::new(MockNasClient::new()),
        Arc::new(MemoryCredentialStore::new()),
    )?;
    let window = coordinator.window().clone_strong();

    window.set_is_logged_in(true);
    window.set_current_view("library".into());
    window.set_apple_sidebar_visible(true);
    window.set_session_user("fixture-user".into());
    window.set_session_nas_name("脱敏 NAS".into());
    window.set_selected_classification_id("fixture-classification".into());
    window.set_selected_classification_name("脱敏海报墙".into());
    window.set_collection_count(9);
    window.set_classifications(ModelRc::from(Rc::new(VecModel::from(vec![
        ClassificationUiItem {
            id: "fixture-classification".into(),
            name: "脱敏海报墙".into(),
            count: 9,
            is_selected: true,
        },
    ]))));
    window.set_collections(ModelRc::from(Rc::new(
        VecModel::from(fixture_collections()),
    )));

    window
        .window()
        .set_size(LogicalSize::new(width as f32, height as f32));
    window.show()?;

    let output_for_timer = output.clone();
    Timer::single_shot(Duration::from_millis(600), move || {
        let result = match window.window().take_snapshot() {
            Ok(snapshot) => save_snapshot(&snapshot, &output_for_timer),
            Err(error) => Err(error.into()),
        };
        if let Err(error) = result {
            eprintln!("poster preview snapshot failed: {error}");
            std::process::exit(1);
        }
        eprintln!(
            "poster preview saved: {} ({}x{})",
            output_for_timer.display(),
            width,
            height
        );
        if hold_ms <= 600 {
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

fn parse_args() -> Result<(u32, u32, PathBuf, u64), Box<dyn std::error::Error>> {
    let args: Vec<String> = env::args().collect();
    let mut width = 1440;
    let mut height = 900;
    let mut output = PathBuf::from("poster-grid-preview.png");
    let mut hold_ms = 600;
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
            value => return Err(format!("unknown argument: {value}").into()),
        }
        index += 1;
    }
    if width == 0 || height == 0 {
        return Err("preview dimensions must be positive".into());
    }
    Ok((width, height, output, hold_ms))
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
) -> Result<(), Box<dyn std::error::Error>> {
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
    Ok(())
}
