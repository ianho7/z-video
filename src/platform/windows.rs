use std::ffi::OsStr;
use std::os::windows::ffi::OsStrExt;
use std::ptr;
use std::sync::atomic::{AtomicBool, Ordering};
use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, RECT, WPARAM};
use windows_sys::Win32::Graphics::Gdi::HBRUSH;
use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
use windows_sys::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DestroyWindow, GetClientRect, RegisterClassW, SetWindowPos,
    ShowWindow, CS_HREDRAW, CS_VREDRAW, SWP_NOACTIVATE, SWP_NOZORDER, SW_HIDE, SW_SHOW,
    WM_ERASEBKGND, WNDCLASSW, WS_CHILD, WS_CLIPCHILDREN, WS_CLIPSIBLINGS, WS_VISIBLE,
};

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
