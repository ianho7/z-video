use log::info;
use z_video::app::AppCoordinator;
use z_video::player::create_player_probe;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Initialize脱敏 logger
    if std::env::var("RUST_LOG").is_err() {
        std::env::set_var("RUST_LOG", "info");
    }
    env_logger::init();

    info!("Starting z-video shell & player probe...");

    // Create player probe (attempts libmpv, falls back gracefully if unavailable)
    let (player, is_native) = create_player_probe(None);
    info!("Player backend initialized: {} (is_native: {})", player.backend_name(), is_native);

    let coordinator = AppCoordinator::new(player, is_native)?;
    info!("AppCoordinator initialized, running desktop window event loop...");

    coordinator.run()?;

    info!("z-video window closed cleanly");
    Ok(())
}
