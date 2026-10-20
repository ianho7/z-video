use std::env;
use std::fs;
use std::path::Path;

fn main() {
    slint_build::compile("ui/app_window.slint").expect("Failed to compile Slint UI definition");

    println!("cargo:rerun-if-changed=ui/app_window.slint");
    println!("cargo:rerun-if-changed=vendor/mpv/libmpv-2.dll");

    // Copy libmpv-2.dll to OUT_DIR or target directory if available
    let manifest_dir = env::var("CARGO_MANIFEST_DIR").unwrap();
    let mpv_dll = Path::new(&manifest_dir).join("vendor").join("mpv").join("libmpv-2.dll");

    if mpv_dll.exists() {
        if let Ok(out_dir) = env::var("OUT_DIR") {
            // Find target/<profile> directory
            let out_path = Path::new(&out_dir);
            // OUT_DIR is typically target/debug/build/<pkg>/out
            if let Some(profile_dir) = out_path.ancestors().nth(3) {
                let dest = profile_dir.join("libmpv-2.dll");
                let dest_alias = profile_dir.join("mpv-2.dll");
                let deps_dir = profile_dir.join("deps");
                let _ = fs::create_dir_all(&deps_dir);
                let dest_deps = deps_dir.join("libmpv-2.dll");
                let dest_deps_alias = deps_dir.join("mpv-2.dll");

                if !dest.exists() {
                    let _ = fs::copy(&mpv_dll, &dest);
                }
                if !dest_alias.exists() {
                    let _ = fs::copy(&mpv_dll, &dest_alias);
                }
                if !dest_deps.exists() {
                    let _ = fs::copy(&mpv_dll, &dest_deps);
                }
                if !dest_deps_alias.exists() {
                    let _ = fs::copy(&mpv_dll, &dest_deps_alias);
                }
            }
        }
    }
}
