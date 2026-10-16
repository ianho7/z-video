#[cfg(windows)]
mod windows_surface_tests {
    use windows_sys::Win32::UI::WindowsAndMessaging::GetDesktopWindow;
    use z_video::platform::Win32VideoSurface;

    #[test]
    fn test_win32_video_surface_creation_and_bounds() {
        let desktop_hwnd = unsafe { GetDesktopWindow() } as isize;
        assert_ne!(desktop_hwnd, 0, "Desktop HWND must not be zero");

        let surface_res = Win32VideoSurface::create(desktop_hwnd, 10, 10, 320, 240);
        assert!(surface_res.is_ok(), "Failed to create Win32VideoSurface: {:?}", surface_res.err());

        let surface = surface_res.unwrap();
        assert_ne!(surface.hwnd(), 0, "Child HWND must not be zero");

        // Test resizing
        surface.set_bounds(20, 20, 640, 480);

        // Test show / hide
        surface.show();
        surface.hide();

        // Dropping surface cleanly destroys Win32 window
        drop(surface);
    }

    #[test]
    fn test_win32_get_client_rect() {
        let desktop_hwnd = unsafe { GetDesktopWindow() } as isize;
        let rect_res = Win32VideoSurface::get_client_rect(desktop_hwnd);
        assert!(rect_res.is_ok(), "GetClientRect failed: {:?}", rect_res.err());

        let (left, top, width, height) = rect_res.unwrap();
        println!("Desktop client rect: left={}, top={}, width={}, height={}", left, top, width, height);
        assert!(width > 0);
        assert!(height > 0);
    }
}
