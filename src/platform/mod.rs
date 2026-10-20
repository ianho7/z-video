#[cfg(windows)]
pub mod windows;

#[cfg(windows)]
pub use windows::{
    apply_native_backdrop, clear_native_backdrop, NativeBackdropOutcome, Win32VideoSurface,
};
