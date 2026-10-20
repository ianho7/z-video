use log::{info, warn};
use std::ffi::c_void;
use std::ffi::OsStr;
use std::mem::size_of;
use std::os::windows::ffi::OsStrExt;
use std::ptr;
use std::sync::atomic::{AtomicBool, Ordering};
use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, RECT, WPARAM};
use windows_sys::Win32::Graphics::Dwm::{
    DwmExtendFrameIntoClientArea, DwmIsCompositionEnabled, DwmSetWindowAttribute,
    DWMSBT_NONE, DWMSBT_TRANSIENTWINDOW, DWMWA_SYSTEMBACKDROP_TYPE,
};
use windows_sys::Win32::Graphics::Gdi::HBRUSH;
use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
use windows_sys::Win32::UI::Accessibility::{HCF_HIGHCONTRASTON, HIGHCONTRASTW};
use windows_sys::Win32::UI::Controls::MARGINS;
use windows_sys::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DestroyWindow, GetClientRect, GetSystemMetrics,
    RegisterClassW, SetWindowPos, ShowWindow, SystemParametersInfoW, CS_HREDRAW, CS_VREDRAW,
    SM_REMOTESESSION, SPI_GETHIGHCONTRAST, SWP_NOACTIVATE, SWP_NOZORDER, SW_HIDE, SW_SHOW,
    WM_ERASEBKGND, WNDCLASSW, WS_CHILD, WS_CLIPCHILDREN, WS_CLIPSIBLINGS, WS_VISIBLE,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NativeBackdropOutcome {
    Applied,
    Fallback { reason: &'static str },
}

/// Removes the window-level backdrop and restores ordinary client-area painting.
/// This is safe to call more than once while a window is being rebuilt.
pub fn clear_native_backdrop(hwnd: isize) -> bool {
    if hwnd == 0 {
        return false;
    }

    let hwnd = hwnd as HWND;
    let backdrop = DWMSBT_NONE;
    let attribute_hr = unsafe {
        DwmSetWindowAttribute(
            hwnd,
            DWMWA_SYSTEMBACKDROP_TYPE as u32,
            &backdrop as *const _ as *const c_void,
            size_of::<i32>() as u32,
        )
    };
    let margins = MARGINS {
        cxLeftWidth: 0,
        cxRightWidth: 0,
        cyTopHeight: 0,
        cyBottomHeight: 0,
    };
    let frame_hr = unsafe { DwmExtendFrameIntoClientArea(hwnd, &margins) };
    attribute_hr >= 0 && frame_hr >= 0
}

/// Applies the Windows 11 system backdrop to the top-level app window.
///
/// This is intentionally window-level: the Slint scene must expose alpha for
/// the Sidebar while painting the main content surface opaque. Callers keep
/// the product opt-in and decide when to set the UI property after `Applied`.
pub fn apply_native_backdrop(hwnd: isize) -> NativeBackdropOutcome {
    if hwnd == 0 {
        return NativeBackdropOutcome::Fallback {
            reason: "missing-window-handle",
        };
    }

    if !dwm_composition_enabled() {
        return NativeBackdropOutcome::Fallback {
            reason: "dwm-composition-disabled",
        };
    }

    if high_contrast_enabled() {
        return NativeBackdropOutcome::Fallback {
            reason: "high-contrast",
        };
    }

    let remote_session = unsafe { GetSystemMetrics(SM_REMOTESESSION) != 0 };
    if remote_session {
        return NativeBackdropOutcome::Fallback {
            reason: "remote-session",
        };
    }

    let hwnd = hwnd as HWND;
    let backdrop = DWMSBT_TRANSIENTWINDOW;
    let attribute_hr = unsafe {
        DwmSetWindowAttribute(
            hwnd,
            DWMWA_SYSTEMBACKDROP_TYPE as u32,
            &backdrop as *const _ as *const c_void,
            size_of::<i32>() as u32,
        )
    };
    if attribute_hr < 0 {
        warn!(
            "native backdrop unavailable: system backdrop API failed (HRESULT {attribute_hr:#x})"
        );
        return NativeBackdropOutcome::Fallback {
            reason: "system-backdrop-api-failed",
        };
    }

    // Extend the system backdrop through the client area. The main content
    // rectangle paints opaque over this window-level surface; the Sidebar can
    // remain translucent and reveal the backdrop.
    let margins = MARGINS {
        cxLeftWidth: -1,
        cxRightWidth: -1,
        cyTopHeight: -1,
        cyBottomHeight: -1,
    };
    let frame_hr = unsafe { DwmExtendFrameIntoClientArea(hwnd, &margins) };
    if frame_hr < 0 {
        let cleanup_succeeded = clear_native_backdrop(hwnd as isize);
        warn!(
            "native backdrop unavailable: client frame API failed (HRESULT {frame_hr:#x}, cleanup={cleanup_succeeded})"
        );
        return NativeBackdropOutcome::Fallback {
            reason: "client-frame-api-failed",
        };
    }

    info!("native backdrop applied to the top-level window");
    NativeBackdropOutcome::Applied
}

fn dwm_composition_enabled() -> bool {
    let mut enabled = 0;
    let hr = unsafe { DwmIsCompositionEnabled(&mut enabled) };
    hr >= 0 && enabled != 0
}

fn high_contrast_enabled() -> bool {
    let mut high_contrast = HIGHCONTRASTW {
        cbSize: size_of::<HIGHCONTRASTW>() as u32,
        dwFlags: 0,
        lpszDefaultScheme: ptr::null_mut(),
    };
    unsafe {
        SystemParametersInfoW(
            SPI_GETHIGHCONTRAST,
            high_contrast.cbSize,
            &mut high_contrast as *mut _ as *mut c_void,
            0,
        ) != 0
            && (high_contrast.dwFlags & HCF_HIGHCONTRASTON) != 0
    }
}

static CLASS_REGISTERED: AtomicBool = AtomicBool::new(false);
const CLASS_NAME: &str = "ZVideoChildSurfaceClass\0";

unsafe extern "system" fn child_window_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    match msg {
        WM_ERASEBKGND => 1, // Prevent flickering by not letting Windows paint the background
        _ => DefWindowProcW(hwnd, msg, wparam, lparam),
    }
}

fn to_wide_chars(s: &str) -> Vec<u16> {
    OsStr::new(s).encode_wide().chain(Some(0)).collect()
}

fn register_class_once() -> Result<(), String> {
    if CLASS_REGISTERED.load(Ordering::Acquire) {
        return Ok(());
    }

    unsafe {
        let hinstance = GetModuleHandleW(ptr::null());
        let class_name_wide = to_wide_chars(CLASS_NAME);

        let wc = WNDCLASSW {
            style: CS_HREDRAW | CS_VREDRAW,
            lpfnWndProc: Some(child_window_proc),
            cbClsExtra: 0,
            cbWndExtra: 0,
            hInstance: hinstance,
            hIcon: ptr::null_mut(),
            hCursor: ptr::null_mut(),
            hbrBackground: ptr::null_mut() as HBRUSH,
            lpszMenuName: ptr::null(),
            lpszClassName: class_name_wide.as_ptr(),
        };

        let atom = RegisterClassW(&wc);
        if atom == 0 {
            // Check if already registered
            let err = std::io::Error::last_os_error();
            if err.raw_os_error() != Some(1410) {
                // ERROR_CLASS_ALREADY_EXISTS = 1410
                return Err(format!("Failed to register window class: {}", err));
            }
        }

        CLASS_REGISTERED.store(true, Ordering::Release);
    }

    Ok(())
}

pub struct Win32VideoSurface {
    hwnd: HWND,
}

unsafe impl Send for Win32VideoSurface {}
unsafe impl Sync for Win32VideoSurface {}

impl Win32VideoSurface {
    /// Creates a native child window attached to the provided parent HWND.
    pub fn create(
        parent_hwnd: isize,
        x: i32,
        y: i32,
        width: i32,
        height: i32,
    ) -> Result<Self, String> {
        register_class_once()?;

        unsafe {
            let hinstance = GetModuleHandleW(ptr::null());
            let class_name_wide = to_wide_chars(CLASS_NAME);

            let hwnd = CreateWindowExW(
                0,
                class_name_wide.as_ptr(),
                ptr::null(),
                WS_CHILD | WS_VISIBLE | WS_CLIPSIBLINGS | WS_CLIPCHILDREN,
                x,
                y,
                width,
                height,
                parent_hwnd as HWND,
                ptr::null_mut(),
                hinstance,
                ptr::null_mut(),
            );

            if hwnd.is_null() {
                return Err(format!(
                    "CreateWindowExW failed: {}",
                    std::io::Error::last_os_error()
                ));
            }

            Ok(Self { hwnd })
        }
    }

    pub fn hwnd(&self) -> isize {
        self.hwnd as isize
    }

    pub fn set_bounds(&self, x: i32, y: i32, width: i32, height: i32) {
        unsafe {
            SetWindowPos(
                self.hwnd,
                ptr::null_mut(),
                x,
                y,
                width,
                height,
                SWP_NOZORDER | SWP_NOACTIVATE,
            );
        }
    }

    pub fn show(&self) {
        unsafe {
            ShowWindow(self.hwnd, SW_SHOW);
        }
    }

    pub fn hide(&self) {
        unsafe {
            ShowWindow(self.hwnd, SW_HIDE);
        }
    }

    pub fn get_client_rect(parent_hwnd: isize) -> Result<(i32, i32, i32, i32), String> {
        unsafe {
            let mut rect: RECT = std::mem::zeroed();
            if GetClientRect(parent_hwnd as HWND, &mut rect) != 0 {
                Ok((
                    rect.left,
                    rect.top,
                    rect.right - rect.left,
                    rect.bottom - rect.top,
                ))
            } else {
                Err(format!(
                    "GetClientRect failed: {}",
                    std::io::Error::last_os_error()
                ))
            }
        }
    }
}

impl Drop for Win32VideoSurface {
    fn drop(&mut self) {
        if !self.hwnd.is_null() {
            unsafe {
                DestroyWindow(self.hwnd);
            }
            self.hwnd = ptr::null_mut();
        }
    }
}
