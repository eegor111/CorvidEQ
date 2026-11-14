//! System tray, close/minimize-to-tray, and Windows startup registration.

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, Window, WindowEvent};
use windows::core::{HSTRING, PCWSTR};
use windows::Win32::Foundation::ERROR_FILE_NOT_FOUND;
use windows::Win32::System::Registry::{
    RegCloseKey, RegCreateKeyExW, RegDeleteValueW, RegGetValueW, RegSetValueExW, HKEY,
    HKEY_CURRENT_USER, KEY_SET_VALUE, REG_OPTION_NON_VOLATILE, REG_SZ, RRF_RT_REG_SZ,
};

const RUN_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
const RUN_VALUE: &str = "CorvidEQ";
const MINIMIZED_ARG: &str = "--minimized";

static CLOSE_TO_TRAY: AtomicBool = AtomicBool::new(false);
static MINIMIZE_TO_TRAY: AtomicBool = AtomicBool::new(false);
static QUITTING: AtomicBool = AtomicBool::new(false);
static HIDDEN: AtomicBool = AtomicBool::new(false);

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartupState {
    enabled: bool,
    minimized: bool,
}

/// Set up the tray icon and either show the main window or keep it hidden (`--minimized`).
pub fn init(app: &tauri::App) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Show CorvidEQ", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;

    let mut builder = TrayIconBuilder::new()
        .menu(&menu)
        .tooltip("CorvidEQ")
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main(app),
            "quit" => {
                QUITTING.store(true, Ordering::Relaxed);
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main(tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon);
    }
    builder.build(app)?;

    let start_hidden = std::env::args().any(|a| a == MINIMIZED_ARG);
    HIDDEN.store(start_hidden, Ordering::Relaxed);
    if !start_hidden {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.show();
        }
    }
    Ok(())
}

/// Restore and focus the main window (from the tray or a second launch).
pub fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        // Unminimize before clearing HIDDEN and showing, so the Resized event
        // from showing doesn't see is_minimized() == true and re-hide to tray.
        let _ = window.unminimize();
        HIDDEN.store(false, Ordering::Relaxed);
        let _ = app.emit("tray-hidden", false);
        let _ = window.show();
        let _ = window.set_focus();
    } else {
        HIDDEN.store(false, Ordering::Relaxed);
        let _ = app.emit("tray-hidden", false);
    }
}

fn hide_main(window: &Window) {
    HIDDEN.store(true, Ordering::Relaxed);
    let _ = window.app_handle().emit("tray-hidden", true);
    let _ = window.hide();
}

/// Intercept close / minimize on the main window when the corresponding tray setting is on.
pub fn on_window_event(window: &Window, event: &WindowEvent) {
    if window.label() != "main" {
        return;
    }
    match event {
        WindowEvent::CloseRequested { api, .. } => {
            if !QUITTING.load(Ordering::Relaxed) && CLOSE_TO_TRAY.load(Ordering::Relaxed) {
                api.prevent_close();
                hide_main(window);
            }
        }
        WindowEvent::Resized(_)
            if MINIMIZE_TO_TRAY.load(Ordering::Relaxed)
                && !HIDDEN.load(Ordering::Relaxed)
                && window.is_minimized().unwrap_or(false) =>
        {
            hide_main(window);
        }
        _ => {}
    }
}

#[tauri::command]
pub fn set_tray_behavior(close_to_tray: bool, minimize_to_tray: bool) {
    CLOSE_TO_TRAY.store(close_to_tray, Ordering::Relaxed);
    MINIMIZE_TO_TRAY.store(minimize_to_tray, Ordering::Relaxed);
}

#[tauri::command]
pub fn is_window_hidden() -> bool {
    HIDDEN.load(Ordering::Relaxed)
}

#[tauri::command]
pub fn get_startup_state() -> StartupState {
    match read_hkcu_run() {
        Some(cmd) => StartupState {
            enabled: true,
            minimized: cmd.contains(MINIMIZED_ARG),
        },
        None => StartupState { enabled: false, minimized: false },
    }
}

#[tauri::command]
pub fn set_startup_state(enabled: bool, minimized: bool) -> Result<StartupState, String> {
    if enabled {
        let exe = std::env::current_exe().map_err(|e| format!("Couldn't locate app executable: {e}"))?;
        let mut cmd = format!("\"{}\"", exe.display());
        if minimized {
            cmd.push_str(" --minimized");
        }
        write_hkcu_run(&cmd)?;
    } else {
        delete_hkcu_run()?;
    }
    Ok(get_startup_state())
}

/// Remove the Windows startup entry when uninstalling so Windows doesn't try to run a deleted exe.
pub fn remove_startup_on_uninstall() {
    if let Err(e) = delete_hkcu_run() {
        crate::errlog::write(&format!("Uninstall couldn't remove Windows startup entry: {e}"));
    }
}

struct RegKey(HKEY);
impl Drop for RegKey {
    fn drop(&mut self) {
        // SAFETY: self.0 is a valid key opened by RegCreateKeyExW.
        unsafe { let _ = RegCloseKey(self.0); }
    }
}

fn open_run_key() -> Result<RegKey, String> {
    let subkey = HSTRING::from(RUN_KEY);
    let mut key = HKEY::default();
    // SAFETY: valid HKEY_CURRENT_USER subkey and output handle.
    unsafe {
        RegCreateKeyExW(
            HKEY_CURRENT_USER,
            PCWSTR(subkey.as_ptr()),
            Some(0),
            PCWSTR::null(),
            REG_OPTION_NON_VOLATILE,
            KEY_SET_VALUE,
            None,
            &mut key,
            None,
        )
        .ok()
        .map_err(|e| format!("Couldn't open Windows startup key: {e}"))?;
    }
    Ok(RegKey(key))
}

fn read_hkcu_run() -> Option<String> {
    let subkey = HSTRING::from(RUN_KEY);
    let value = HSTRING::from(RUN_VALUE);
    let mut size = 0u32;
    // SAFETY: first call measures buffer size, second reads the UTF-16 string.
    unsafe {
        RegGetValueW(
            HKEY_CURRENT_USER,
            PCWSTR(subkey.as_ptr()),
            PCWSTR(value.as_ptr()),
            RRF_RT_REG_SZ,
            None,
            None,
            Some(&mut size),
        )
        .ok()
        .ok()?;
        let mut buf = vec![0u16; (size as usize).div_ceil(2)];
        RegGetValueW(
            HKEY_CURRENT_USER,
            PCWSTR(subkey.as_ptr()),
            PCWSTR(value.as_ptr()),
            RRF_RT_REG_SZ,
            None,
            Some(buf.as_mut_ptr().cast()),
            Some(&mut size),
        )
        .ok()
        .ok()?;
        let text = String::from_utf16_lossy(&buf).trim_end_matches('\0').to_string();
        (!text.is_empty()).then_some(text)
    }
}

fn write_hkcu_run(command: &str) -> Result<(), String> {
    let key = open_run_key()?;
    let value = HSTRING::from(RUN_VALUE);
    let wide: Vec<u16> = command.encode_utf16().chain(std::iter::once(0)).collect();
    let bytes = unsafe { std::slice::from_raw_parts(wide.as_ptr().cast::<u8>(), wide.len() * 2) };
    // SAFETY: key is valid, value is null-terminated UTF-16, bytes matches its byte length.
    unsafe {
        RegSetValueExW(key.0, PCWSTR(value.as_ptr()), Some(0), REG_SZ, Some(bytes))
            .ok()
            .map_err(|e| format!("Couldn't save Windows startup entry: {e}"))
    }
}

fn delete_hkcu_run() -> Result<(), String> {
    let key = open_run_key()?;
    let value = HSTRING::from(RUN_VALUE);
    // SAFETY: key is valid and value is null-terminated UTF-16.
    let err = unsafe { RegDeleteValueW(key.0, PCWSTR(value.as_ptr())) };
    if err.is_ok() || err == ERROR_FILE_NOT_FOUND {
        Ok(())
    } else {
        Err(format!("Couldn't remove Windows startup entry: {err:?}"))
    }
}
