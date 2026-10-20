use log::info;
use z_video::app::AppCoordinator;
use z_video::diagnostics;
use z_video::player::create_player_probe;

#[cfg(windows)]
fn environment_flag_enabled(name: &str) -> bool {
    matches!(
        std::env::var(name).ok().as_deref(),
        Some("1" | "true" | "yes" | "on")
    )
}

#[cfg(windows)]
fn environment_flag_enabled_by_default(name: &str) -> bool {
    !matches!(
        std::env::var(name).ok().as_deref(),
        Some("0" | "false" | "no" | "off")
    )
}

#[cfg(windows)]
fn configure_windows_renderer() -> Result<(), Box<dyn std::error::Error>> {
    let native_backdrop_requested =
        environment_flag_enabled_by_default("Z_VIDEO_NATIVE_BACKDROP");
    let transparency_disabled = environment_flag_enabled("Z_VIDEO_REDUCED_TRANSPARENCY")
        || environment_flag_enabled("Z_VIDEO_HIGH_CONTRAST");

    let use_native_backdrop = native_backdrop_requested && !transparency_disabled;
    let renderer_name = if use_native_backdrop {
        "skia-opengl"
    } else {
        "skia-wgpu"
    };
    let selector = slint::BackendSelector::new()
        .backend_name("winit".into())
        .renderer_name(renderer_name.into());

    if use_native_backdrop {
        // DX12/WGPU commonly advertises only the Opaque composite alpha mode
        // for a Win32 swapchain. The native experiment therefore uses Skia's
        // OpenGL surface, whose WGL config can carry an alpha buffer, while
        // keeping the product default on the existing WGPU path.
        match selector
            // Keep the client surface alpha-capable from window creation. The
            // product UI still decides which pixels are transparent.
            .with_winit_window_attributes_hook(|attributes| attributes.with_transparent(true))
            .select()
        {
            Ok(_) => {}
            Err(error) => {
                eprintln!(
                    "native backdrop renderer unavailable; falling back to skia-wgpu: {error}"
                );
                slint::BackendSelector::new()
                    .backend_name("winit".into())
                    .renderer_name("skia-wgpu".into())
                    .select()?;
            }
        }
    } else {
        selector.select()?;
    }

    Ok(())
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Ticket #9 uses the Skia renderer for the Windows glass-layer candidate.
    // The dependency features keep this backend available in the formal build;
    // the selector makes the native window choice explicit at runtime. The
    // The Windows path attempts the alpha-capable OpenGL surface by default;
    // reduced-transparency, high-contrast, explicit opt-out, and unavailable
    // native rendering fall back to the WGPU selection.
    #[cfg(windows)]
    configure_windows_renderer()?;

    // Initialize脱敏 logger
    if std::env::var("RUST_LOG").is_err() {
        std::env::set_var("RUST_LOG", "info");
    }
    env_logger::init();
    info!("Diagnostics log file: {}", diagnostics::log_file_path().display());

    let startup = diagnostics::start_event("app", "startup");
    info!("Starting z-video shell & player probe...");

    // Create player probe (attempts libmpv, falls back gracefully if unavailable)
    let (player, is_native) = create_player_probe(None);
    info!("Player backend initialized: {} (is_native: {})", player.backend_name(), is_native);

    let coordinator = AppCoordinator::new(player, is_native)?;
    info!("AppCoordinator initialized, running desktop window event loop...");
    startup.finish("success", &[("backend", coordinator.window().get_engine_name().to_string())]);

    coordinator.run()?;

    diagnostics::record_event(
        "app",
        "shutdown",
        "complete",
        "success",
        std::time::Duration::ZERO,
        &[],
    );
    diagnostics::flush();
    info!("z-video window closed cleanly");
    Ok(())
}
