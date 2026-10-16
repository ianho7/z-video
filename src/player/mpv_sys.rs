use std::ffi::{c_char, c_void, CStr, CString};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use libloading::{Library, Symbol};

pub const MPV_FORMAT_NONE: i32 = 0;
pub const MPV_FORMAT_STRING: i32 = 1;
pub const MPV_FORMAT_OSD_STRING: i32 = 2;
pub const MPV_FORMAT_FLAG: i32 = 3;
pub const MPV_FORMAT_INT64: i32 = 4;
pub const MPV_FORMAT_DOUBLE: i32 = 5;

pub const MPV_EVENT_NONE: i32 = 0;
pub const MPV_EVENT_SHUTDOWN: i32 = 1;
pub const MPV_EVENT_START_FILE: i32 = 6;
pub const MPV_EVENT_END_FILE: i32 = 7;
pub const MPV_EVENT_FILE_LOADED: i32 = 8;
pub const MPV_EVENT_IDLE: i32 = 11;
pub const MPV_EVENT_PLAYBACK_RESTART: i32 = 21;
pub const MPV_EVENT_PROPERTY_CHANGE: i32 = 22;

#[repr(C)]
pub struct MpvEvent {
    pub event_id: i32,
    pub error: i32,
    pub reply_userdata: u64,
    pub data: *mut c_void,
}

#[repr(C)]
pub struct MpvEventProperty {
    pub name: *const c_char,
    pub format: i32,
    pub data: *mut c_void,
}

pub type MpvHandle = *mut c_void;

pub struct MpvApi {
    _lib: Arc<Library>,
    pub client_api_version: unsafe extern "C" fn() -> u64,
    pub error_string: unsafe extern "C" fn(i32) -> *const c_char,
    pub create: unsafe extern "C" fn() -> MpvHandle,
    pub initialize: unsafe extern "C" fn(MpvHandle) -> i32,
    pub command: unsafe extern "C" fn(MpvHandle, *mut *const c_char) -> i32,
    pub command_string: unsafe extern "C" fn(MpvHandle, *const c_char) -> i32,
    pub set_option_string: unsafe extern "C" fn(MpvHandle, *const c_char, *const c_char) -> i32,
    pub set_property_string: unsafe extern "C" fn(MpvHandle, *const c_char, *const c_char) -> i32,
    pub get_property_string: unsafe extern "C" fn(MpvHandle, *const c_char) -> *mut c_char,
    pub set_property: unsafe extern "C" fn(MpvHandle, *const c_char, i32, *mut c_void) -> i32,
    pub get_property: unsafe extern "C" fn(MpvHandle, *const c_char, i32, *mut c_void) -> i32,
    pub observe_property: unsafe extern "C" fn(MpvHandle, u64, *const c_char, i32) -> i32,
    pub unobserve_property: unsafe extern "C" fn(MpvHandle, u64) -> i32,
    pub wait_event: unsafe extern "C" fn(MpvHandle, f64) -> *mut MpvEvent,
    pub wakeup: unsafe extern "C" fn(MpvHandle),
    pub free: unsafe extern "C" fn(*mut c_void),
    pub terminate_destroy: unsafe extern "C" fn(MpvHandle),
}

unsafe impl Send for MpvApi {}
unsafe impl Sync for MpvApi {}

impl MpvApi {
    pub fn load_from_path(path: &Path) -> Result<Self, String> {
        let lib = unsafe { Library::new(path) }
            .map_err(|e| format!("Failed to load mpv library at '{}': {}", path.display(), e))?;
        let lib = Arc::new(lib);

        unsafe {
            macro_rules! sym {
                ($name:ident, $sym:literal, $t:ty) => {{
                    let s: Symbol<$t> = lib
                        .get($sym)
                        .map_err(|e| format!("Symbol '{}' missing in mpv library: {}", stringify!($sym), e))?;
                    *s
                }};
            }

            let client_api_version = sym!(client_api_version, b"mpv_client_api_version\0", unsafe extern "C" fn() -> u64);
            let error_string = sym!(error_string, b"mpv_error_string\0", unsafe extern "C" fn(i32) -> *const c_char);
            let create = sym!(create, b"mpv_create\0", unsafe extern "C" fn() -> MpvHandle);
            let initialize = sym!(initialize, b"mpv_initialize\0", unsafe extern "C" fn(MpvHandle) -> i32);
            let command = sym!(command, b"mpv_command\0", unsafe extern "C" fn(MpvHandle, *mut *const c_char) -> i32);
            let command_string = sym!(command_string, b"mpv_command_string\0", unsafe extern "C" fn(MpvHandle, *const c_char) -> i32);
            let set_option_string = sym!(set_option_string, b"mpv_set_option_string\0", unsafe extern "C" fn(MpvHandle, *const c_char, *const c_char) -> i32);
            let set_property_string = sym!(set_property_string, b"mpv_set_property_string\0", unsafe extern "C" fn(MpvHandle, *const c_char, *const c_char) -> i32);
            let get_property_string = sym!(get_property_string, b"mpv_get_property_string\0", unsafe extern "C" fn(MpvHandle, *const c_char) -> *mut c_char);
            let set_property = sym!(set_property, b"mpv_set_property\0", unsafe extern "C" fn(MpvHandle, *const c_char, i32, *mut c_void) -> i32);
            let get_property = sym!(get_property, b"mpv_get_property\0", unsafe extern "C" fn(MpvHandle, *const c_char, i32, *mut c_void) -> i32);
            let observe_property = sym!(observe_property, b"mpv_observe_property\0", unsafe extern "C" fn(MpvHandle, u64, *const c_char, i32) -> i32);
            let unobserve_property = sym!(unobserve_property, b"mpv_unobserve_property\0", unsafe extern "C" fn(MpvHandle, u64) -> i32);
            let wait_event = sym!(wait_event, b"mpv_wait_event\0", unsafe extern "C" fn(MpvHandle, f64) -> *mut MpvEvent);
            let wakeup = sym!(wakeup, b"mpv_wakeup\0", unsafe extern "C" fn(MpvHandle));
            let free = sym!(free, b"mpv_free\0", unsafe extern "C" fn(*mut c_void));
            let terminate_destroy = sym!(terminate_destroy, b"mpv_terminate_destroy\0", unsafe extern "C" fn(MpvHandle));

            Ok(Self {
                _lib: lib,
                client_api_version,
                error_string,
                create,
                initialize,
                command,
                command_string,
                set_option_string,
                set_property_string,
                get_property_string,
                set_property,
                get_property,
                observe_property,
                unobserve_property,
                wait_event,
                wakeup,
                free,
                terminate_destroy,
            })
        }
    }

    pub fn auto_load() -> Result<(Self, PathBuf), String> {
        if let Some(path) = find_mpv_library_path() {
            let api = Self::load_from_path(&path)?;
            Ok((api, path))
        } else {
            // Last resort: let OS search default PATH
            #[cfg(target_os = "windows")]
            let fallback_name = "mpv-2.dll";
            #[cfg(not(target_os = "windows"))]
            let fallback_name = "libmpv.so.2";

            let path = PathBuf::from(fallback_name);
            let api = Self::load_from_path(&path)?;
            Ok((api, path))
        }
    }

    pub fn get_error_message(&self, code: i32) -> String {
        unsafe {
            let ptr = (self.error_string)(code);
            if ptr.is_null() {
                format!("Unknown error code {}", code)
            } else {
                CStr::from_ptr(ptr).to_string_lossy().to_string()
            }
        }
    }
}

pub fn find_mpv_library_path() -> Option<PathBuf> {
    if let Ok(env_path) = std::env::var("MPV_DLL_PATH") {
        let p = PathBuf::from(env_path);
        if p.exists() {
            return Some(p);
        }
    }

    let candidates = [
        "vendor/mpv/libmpv-2.dll",
        "vendor/mpv/mpv-2.dll",
        "libmpv-2.dll",
        "mpv-2.dll",
        "../vendor/mpv/libmpv-2.dll",
    ];

    for c in &candidates {
        let p = PathBuf::from(c);
        if p.exists() {
            return Some(p);
        }
    }

    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            for name in &["libmpv-2.dll", "mpv-2.dll"] {
                let p = parent.join(name);
                if p.exists() {
                    return Some(p);
                }
            }
            if let Some(grandparent) = parent.parent() {
                for name in &["libmpv-2.dll", "mpv-2.dll"] {
                    let p = grandparent.join(name);
                    if p.exists() {
                        return Some(p);
                    }
                }
            }
        }
    }

    None
}

pub fn str_to_cstring(s: &str) -> CString {
    CString::new(s).unwrap_or_else(|_| CString::new("").unwrap())
}
