//! CorvidEQ and Equalizer APO's config folder.
//!
//! What Equalizer APO applies is decided by ONE file, `config.txt`. Right now
//! it holds the user's previous setup (e.g. an `Include:` line for another
//! EQ app). CorvidEQ:
//!
//! - always writes its own file, `corvid-eq.txt` (harmless on its own: nothing
//!   uses it until `config.txt` includes it);
//! - only touches `config.txt` when the user switches CorvidEQ on or off:
//!   - **on**: the user's exact `config.txt` is copied to
//!     `config-before-corvideq.txt` (same folder, easy to find), then
//!     `config.txt` becomes "Include: corvid-eq.txt";
//!   - **off**: the copy is written back byte for byte, checked, and only then
//!     deleted. If something else changed `config.txt` meanwhile, it is left
//!     alone (and the copy kept) instead of being overwritten.
//!
//! CorvidEQ's EQ keeps working after the app closes normally (like any EQ app).
//! If the app CRASHES (a Rust panic), `release_after_crash()` switches it off
//! on the way down, so your previous setup comes back. A hard kill (Task
//! Manager, power loss) gives the app no chance to run anything: then the EQ
//! simply stays as it was, exactly like a normal close.
//!
//! Every write goes to a temp file first and is then renamed over the real
//! file, so Equalizer APO (which reloads files when they change) never reads
//! half a file.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, RwLock};

use windows::core::{HSTRING, PCWSTR};
use windows::Win32::UI::Shell::ShellExecuteW;
use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

pub const FILE_NAME: &str = "corvid-eq.txt";
const CONFIG_NAME: &str = "config.txt";
const BACKUP_NAME: &str = "config-before-corvideq.txt";

/// What `config.txt` contains while CorvidEQ is switched on.
const MANAGED_CONFIG: &str = "# Written by CorvidEQ. Your previous config.txt is saved as\r\n\
# config-before-corvideq.txt; switching CorvidEQ off in the app puts it back.\r\n\
Include: corvid-eq.txt\r\n";

/// Optional custom Equalizer APO config folder chosen by the user.
/// Backed by a small file in `%LOCALAPPDATA%` so startup writes don't race UI
/// rehydration and `--release-eapo` on uninstall can find a custom folder.
static CUSTOM_CONFIG_DIR: LazyLock<RwLock<Option<PathBuf>>> =
    LazyLock::new(|| RwLock::new(read_saved_custom_dir()));

fn custom_dir_file() -> Option<PathBuf> {
    crate::errlog::app_dir().map(|dir| dir.join("custom-config-dir.txt"))
}

fn read_saved_custom_dir() -> Option<PathBuf> {
    let text = fs::read_to_string(custom_dir_file()?).ok()?;
    let trimmed = text.trim();
    (!trimmed.is_empty()).then(|| PathBuf::from(trimmed))
}

fn save_custom_dir(path: Option<&Path>) {
    let Some(file) = custom_dir_file() else { return };
    match path {
        Some(dir) => {
            if let Some(parent) = file.parent() {
                if fs::create_dir_all(parent).is_ok() {
                    let _ = fs::write(&file, dir.to_string_lossy().as_bytes());
                }
            }
        }
        None => {
            let _ = fs::remove_file(&file);
        }
    }
}

/// Where Equalizer APO's installer records its folders (`InstallPath`, `ConfigPath`).
const EAPO_REG_KEY: &str = r"SOFTWARE\EqualizerAPO";

/// Equalizer APO's tool for picking the devices it runs on, newest name first:
/// 1.4.2 ships `DeviceSelector.exe`, older versions `Configurator.exe`.
const DEVICE_TOOLS: [&str; 2] = ["DeviceSelector.exe", "Configurator.exe"];

const SOURCE_WEBSITE: &str = "https://github.com/eegor111/CorvidEQ";
const ISSUES_WEBSITE: &str = "https://github.com/eegor111/CorvidEQ/issues";
const FFT_VIDEO_WEBSITE: &str = "https://www.youtube.com/watch?v=nmgFG7PUHfo";

/// The folder we work in: user-chosen custom config folder if set, else the
/// one Equalizer APO itself uses (`default_config_dir`).
fn config_dir() -> PathBuf {
    if let Ok(guard) = CUSTOM_CONFIG_DIR.read() {
        if let Some(custom) = guard.as_ref() {
            return custom.clone();
        }
    }
    default_config_dir()
}

/// Equalizer APO's config folder as its installer recorded it (it can be
/// installed anywhere), else `<install folder>\config`.
fn default_config_dir() -> PathBuf {
    crate::devices::read_reg_string(EAPO_REG_KEY, "ConfigPath")
        .filter(|p| !p.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| install_dir().join("config"))
}

/// Equalizer APO's install folder as its installer recorded it, else
/// `<Program Files>\EqualizerAPO`, where it installs by default.
fn install_dir() -> PathBuf {
    crate::devices::read_reg_string(EAPO_REG_KEY, "InstallPath")
        .filter(|p| !p.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            std::env::var_os("ProgramFiles")
                .map(PathBuf::from)
                .unwrap_or_else(|| PathBuf::from(r"C:\Program Files"))
                .join("EqualizerAPO")
        })
}

/// Where the device tool is. Only looked for, never started: the user runs it
/// (no Windows prompts coming from this app, user's choice), so the UI names
/// it and says when it's missing. The installer's record comes first: a custom config folder can sit anywhere, so its parent is only a
/// fallback. `Err` = nowhere, with the path to show as tried.
fn device_selector() -> Result<PathBuf, PathBuf> {
    let mut dirs = vec![install_dir()];
    if let Ok(guard) = CUSTOM_CONFIG_DIR.read() {
        dirs.extend(guard.as_ref().and_then(|custom| custom.parent()).map(Path::to_path_buf));
    }
    dirs.iter()
        .flat_map(|dir| DEVICE_TOOLS.map(|name| dir.join(name)))
        .find(|path| path.is_file())
        .ok_or_else(|| install_dir().join(DEVICE_TOOLS[0]))
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EapoStatus {
    /// The folder we looked in.
    config_dir: String,
    /// Whether that folder exists.
    installed: bool,
    /// Full path of CorvidEQ's file.
    file_path: String,
    /// Whether `config.txt` includes CorvidEQ's file: Equalizer APO uses it.
    included: bool,
    /// Whether a saved copy of the previous `config.txt` exists.
    has_backup: bool,
    /// Whether Equalizer APO's device tool was found.
    device_selector: bool,
    /// Where it is, or where we looked.
    device_selector_path: String,
}

/// Where things are and whether CorvidEQ is switched on. Reads only.
#[tauri::command]
pub fn eapo_status() -> EapoStatus {
    status_in(&config_dir())
}

/// Set or reset custom config directory. Pass None (or empty) to reset to default.
#[tauri::command]
pub fn eapo_set_config_dir(path: Option<String>) -> Result<EapoStatus, String> {
    let next = path.filter(|p| !p.trim().is_empty()).map(PathBuf::from);
    save_custom_dir(next.as_deref());
    let mut guard = CUSTOM_CONFIG_DIR.write().map_err(|e| e.to_string())?;
    *guard = next;
    drop(guard);
    Ok(eapo_status())
}

/// Open the currently configured config folder in Windows Explorer.
#[tauri::command]
pub fn open_config_folder() -> Result<(), String> {
    let dir = config_dir();
    if !dir.is_dir() {
        return Err(format!("Folder does not exist: {}", dir.display()));
    }
    std::process::Command::new("explorer")
        .arg(&dir)
        .spawn()
        .map_err(|e| format!("Failed to open Explorer: {e}"))?;
    Ok(())
}

/// Write CorvidEQ's own file. Returns its full path, or a readable error.
#[tauri::command]
pub fn write_eq_file(text: String) -> Result<String, String> {
    let dir = existing_dir()?;
    write_atomic(&dir, FILE_NAME, text.as_bytes())?;
    Ok(dir.join(FILE_NAME).display().to_string())
}

/// Switch CorvidEQ on: save the user's config.txt, then point it at our file.
#[tauri::command]
pub fn eapo_switch_on() -> Result<EapoStatus, String> {
    let dir = existing_dir()?;
    switch_on_in(&dir)?;
    Ok(status_in(&dir))
}

/// Switch CorvidEQ off: put the saved config.txt back exactly as it was.
#[tauri::command]
pub fn eapo_switch_off() -> Result<EapoStatus, String> {
    let dir = existing_dir()?;
    switch_off_in(&dir)?;
    Ok(status_in(&dir))
}

/// Save an exported EQ config (Save file…, `.txt`) where the user picked in
/// the Save window. The one write outside the app's own folders, so it stays
/// as narrow as the feature needs.
#[tauri::command]
pub fn export_config(path: String, text: String) -> Result<(), String> {
    let path = PathBuf::from(path);
    // Only the kind of file the app exports: EQ configs.
    if !path.extension().is_some_and(|e| e.eq_ignore_ascii_case("txt")) {
        return Err("Only .txt files can be saved".into());
    }
    fs::write(&path, text).map_err(|e| format!("Couldn't save {}: {e}", path.display()))
}

/// Open a fixed, hardcoded URL in the user's default browser.
fn open_fixed_url(url: &str) -> Result<(), String> {
    if shell_open(&HSTRING::from(url)) {
        Ok(())
    } else {
        Err(format!("Windows couldn't open {url}"))
    }
}

/// Show CorvidEQ's source code in the user's browser (the About window).
#[tauri::command]
pub fn open_source_website() -> Result<(), String> {
    open_fixed_url(SOURCE_WEBSITE)
}

/// Show CorvidEQ's issue tracker in the user's browser (the About window).
#[tauri::command]
pub fn open_issues_website() -> Result<(), String> {
    open_fixed_url(ISSUES_WEBSITE)
}

/// Show the FFT explainer video in the user's browser (Settings → Analyzer).
#[tauri::command]
pub fn open_fft_video() -> Result<(), String> {
    open_fixed_url(FFT_VIDEO_WEBSITE)
}

/// Open a web address in the user's browser.
fn shell_open(target: &HSTRING) -> bool {
    // SAFETY: plain strings that live until the call returns; no window handle needed.
    let result = unsafe { ShellExecuteW(None, PCWSTR::null(), PCWSTR(target.as_ptr()), PCWSTR::null(), PCWSTR::null(), SW_SHOWNORMAL) };
    // Values above 32 mean success.
    result.0 as usize > 32
}

/// Run by the uninstaller (`corvid-eq.exe --release-eapo`, see
/// `windows/hooks.nsh`): without the app there'd be no way left to switch
/// CorvidEQ off, so put the previous config.txt back, then remove our file
/// once nothing uses it. Uses the saved custom folder if set, else Equalizer
/// APO's own folder.
pub fn release_on_uninstall() {
    let dir = config_dir();
    release_in(&dir);
    let default = default_config_dir();
    if dir != default {
        release_in(&default);
    }
    save_custom_dir(None);
}

// --- The actual work, on a given folder -------------------------------------------

fn release_in(dir: &Path) {
    let status = status_in(dir);
    if status.included && status.has_backup {
        if let Err(e) = switch_off_in(dir) {
            crate::errlog::write(&format!("Uninstall couldn't put your previous setup back: {e}"));
        }
    }
    if !status_in(dir).included {
        let _ = fs::remove_file(dir.join(FILE_NAME));
    }
}

fn status_in(dir: &Path) -> EapoStatus {
    let included = fs::read_to_string(dir.join(CONFIG_NAME))
        .map(|text| includes_our_file(&text))
        .unwrap_or(false);
    let tool = device_selector();
    EapoStatus {
        config_dir: dir.display().to_string(),
        installed: dir.is_dir(),
        file_path: dir.join(FILE_NAME).display().to_string(),
        included,
        has_backup: dir.join(BACKUP_NAME).is_file(),
        device_selector: tool.is_ok(),
        device_selector_path: tool.unwrap_or_else(|tried| tried).display().to_string(),
    }
}

fn switch_on_in(dir: &Path) -> Result<(), String> {
    if !dir.join(FILE_NAME).is_file() {
        return Err(format!("{FILE_NAME} hasn't been written yet, so there's nothing to switch to"));
    }
    let current = fs::read(dir.join(CONFIG_NAME)).map_err(|e| describe(&e, dir))?;
    if includes_our_file(&String::from_utf8_lossy(&current)) {
        return Ok(()); // already on
    }
    // 1) Save the user's exact config.txt, and make sure the copy is identical.
    write_atomic(dir, BACKUP_NAME, &current)?;
    let saved = fs::read(dir.join(BACKUP_NAME)).map_err(|e| describe(&e, dir))?;
    if saved != current {
        return Err("The saved copy of config.txt didn't match; nothing was changed".into());
    }
    // 2) Only then point Equalizer APO at CorvidEQ's file.
    write_atomic(dir, CONFIG_NAME, MANAGED_CONFIG.as_bytes())
}

fn switch_off_in(dir: &Path) -> Result<(), String> {
    let backup_path = dir.join(BACKUP_NAME);
    let saved = fs::read(&backup_path)
        .map_err(|_| format!("There's no saved config ({BACKUP_NAME}) to put back"))?;
    let current = fs::read_to_string(dir.join(CONFIG_NAME)).unwrap_or_default();
    if current != MANAGED_CONFIG {
        // Something else changed config.txt while CorvidEQ was on: don't
        // overwrite that. The saved copy stays where it is.
        return Err(format!(
            "config.txt was changed by something else while CorvidEQ was on, so it was left as it is. \
             Your previous config is still saved as {BACKUP_NAME}."
        ));
    }
    // 1) Put the user's config back, and check it's identical.
    write_atomic(dir, CONFIG_NAME, &saved)?;
    let restored = fs::read(dir.join(CONFIG_NAME)).map_err(|e| describe(&e, dir))?;
    if restored != saved {
        return Err(format!("config.txt didn't come back identical; {BACKUP_NAME} was kept"));
    }
    // 2) Only then remove the copy.
    fs::remove_file(&backup_path).map_err(|e| describe(&e, dir))
}

// --- Helpers -----------------------------------------------------------------------

fn existing_dir() -> Result<PathBuf, String> {
    let dir = config_dir();
    if dir.is_dir() {
        Ok(dir)
    } else {
        Err(format!("Equalizer APO's config folder wasn't found at {}", dir.display()))
    }
}

/// Write via a temp file + rename (on Windows, rename replaces the old file in one step).
pub(crate) fn write_atomic(dir: &Path, name: &str, bytes: &[u8]) -> Result<(), String> {
    let temp = dir.join(format!("{name}.tmp"));
    fs::write(&temp, bytes).map_err(|e| describe(&e, dir))?;
    fs::rename(&temp, dir.join(name)).map_err(|e| describe(&e, dir))
}

/// An active (not commented out) `Include:` line that names our file.
fn includes_our_file(config: &str) -> bool {
    config.lines().any(|line| {
        let line = line.trim();
        let lower = line.to_lowercase();
        !line.starts_with('#') && lower.starts_with("include:") && lower.contains(&FILE_NAME.to_lowercase())
    })
}

fn describe(e: &io::Error, dir: &Path) -> String {
    match e.kind() {
        io::ErrorKind::PermissionDenied => {
            format!("Windows didn't allow writing to {} (permission denied)", dir.display())
        }
        _ => format!("Couldn't write to {}: {e}", dir.display()),
    }
}

/// Everything here runs on a throwaway folder in Windows' temp directory, never
/// on Equalizer APO's real one, so it's safe to run on a machine that uses it.
#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};

    /// Not valid UTF-8, mixed line endings, no final newline: the copy has to
    /// keep the bytes, not just the text.
    const USERS_CONFIG: &[u8] = b"# caf\xE9\r\nInclude: other.txt\nPreamp: -3 dB";
    const OTHER_APPS_CONFIG: &[u8] = b"Include: another-app.txt\r\n";

    static NEXT: AtomicU32 = AtomicU32::new(0);

    /// A config folder of its own (tests run at the same time), removed afterwards.
    struct Folder(PathBuf);

    impl Folder {
        /// As the app finds it: the user's config.txt, and our file already written.
        fn new() -> Self {
            let name = format!("corvid-eq-test-{}-{}", std::process::id(), NEXT.fetch_add(1, Ordering::Relaxed));
            let dir = std::env::temp_dir().join(name);
            fs::create_dir_all(&dir).unwrap();
            let folder = Self(dir);
            folder.write(CONFIG_NAME, USERS_CONFIG);
            folder.write(FILE_NAME, b"Preamp: 0 dB\r\n");
            folder
        }
        fn write(&self, name: &str, bytes: &[u8]) {
            fs::write(self.0.join(name), bytes).unwrap();
        }
        fn read(&self, name: &str) -> Vec<u8> {
            fs::read(self.0.join(name)).unwrap()
        }
        fn has(&self, name: &str) -> bool {
            self.0.join(name).is_file()
        }
    }

    impl Drop for Folder {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn on_saves_an_exact_copy_then_includes_our_file() {
        let f = Folder::new();
        switch_on_in(&f.0).unwrap();
        assert_eq!(f.read(BACKUP_NAME), USERS_CONFIG);
        assert_eq!(f.read(CONFIG_NAME), MANAGED_CONFIG.as_bytes());
        let status = status_in(&f.0);
        assert!(status.included && status.has_backup);
    }

    #[test]
    fn off_restores_byte_for_byte_and_removes_the_copy() {
        let f = Folder::new();
        switch_on_in(&f.0).unwrap();
        switch_off_in(&f.0).unwrap();
        assert_eq!(f.read(CONFIG_NAME), USERS_CONFIG);
        assert!(!f.has(BACKUP_NAME));
        assert!(!status_in(&f.0).included);
    }

    #[test]
    fn off_refuses_if_another_app_changed_config() {
        let f = Folder::new();
        switch_on_in(&f.0).unwrap();
        f.write(CONFIG_NAME, OTHER_APPS_CONFIG);
        assert!(switch_off_in(&f.0).is_err());
        assert_eq!(f.read(CONFIG_NAME), OTHER_APPS_CONFIG);
        assert_eq!(f.read(BACKUP_NAME), USERS_CONFIG);
    }

    #[test]
    fn off_without_a_copy_changes_nothing() {
        let f = Folder::new();
        assert!(switch_off_in(&f.0).is_err());
        assert_eq!(f.read(CONFIG_NAME), USERS_CONFIG);
    }

    /// A second on must not save our own config.txt over the user's copy.
    #[test]
    fn on_twice_keeps_the_users_copy() {
        let f = Folder::new();
        switch_on_in(&f.0).unwrap();
        switch_on_in(&f.0).unwrap();
        assert_eq!(f.read(BACKUP_NAME), USERS_CONFIG);
        switch_off_in(&f.0).unwrap();
        assert_eq!(f.read(CONFIG_NAME), USERS_CONFIG);
    }

    /// User's choice: off brings back what was there when you pressed on.
    #[test]
    fn on_after_another_app_took_over_saves_that_config() {
        let f = Folder::new();
        switch_on_in(&f.0).unwrap();
        f.write(CONFIG_NAME, OTHER_APPS_CONFIG);
        switch_on_in(&f.0).unwrap();
        assert_eq!(f.read(BACKUP_NAME), OTHER_APPS_CONFIG);
        switch_off_in(&f.0).unwrap();
        assert_eq!(f.read(CONFIG_NAME), OTHER_APPS_CONFIG);
    }

    #[test]
    fn on_before_our_file_exists_changes_nothing() {
        let f = Folder::new();
        fs::remove_file(f.0.join(FILE_NAME)).unwrap();
        assert!(switch_on_in(&f.0).is_err());
        assert_eq!(f.read(CONFIG_NAME), USERS_CONFIG);
        assert!(!f.has(BACKUP_NAME));
    }

    #[test]
    fn on_without_a_config_changes_nothing() {
        let f = Folder::new();
        fs::remove_file(f.0.join(CONFIG_NAME)).unwrap();
        assert!(switch_on_in(&f.0).is_err());
        assert!(!f.has(CONFIG_NAME) && !f.has(BACKUP_NAME));
    }

    #[test]
    fn uninstall_puts_the_config_back_and_removes_our_file() {
        let f = Folder::new();
        switch_on_in(&f.0).unwrap();
        release_in(&f.0);
        assert_eq!(f.read(CONFIG_NAME), USERS_CONFIG);
        assert!(!f.has(BACKUP_NAME) && !f.has(FILE_NAME));
    }

    #[test]
    fn uninstall_while_off_only_removes_our_file() {
        let f = Folder::new();
        release_in(&f.0);
        assert_eq!(f.read(CONFIG_NAME), USERS_CONFIG);
        assert!(!f.has(FILE_NAME));
    }

    /// Another app's config.txt still includes our file: removing it would break that.
    #[test]
    fn uninstall_keeps_our_file_while_something_still_includes_it() {
        let f = Folder::new();
        switch_on_in(&f.0).unwrap();
        let changed = b"Preamp: -1 dB\r\nInclude: corvid-eq.txt\r\n";
        f.write(CONFIG_NAME, changed);
        release_in(&f.0);
        assert_eq!(f.read(CONFIG_NAME), changed);
        assert_eq!(f.read(BACKUP_NAME), USERS_CONFIG);
        assert!(f.has(FILE_NAME));
    }

    #[test]
    fn only_an_active_include_of_our_file_counts() {
        assert!(includes_our_file("Include: corvid-eq.txt"));
        assert!(includes_our_file("Preamp: 0 dB\r\n  INCLUDE: Corvid-EQ.txt\r\n"));
        assert!(!includes_our_file("# Include: corvid-eq.txt"));
        assert!(!includes_our_file("Include: other.txt"));
        assert!(!includes_our_file(""));
    }

    #[test]
    fn writing_replaces_the_file_and_leaves_no_temp_file() {
        let f = Folder::new();
        write_atomic(&f.0, CONFIG_NAME, b"new").unwrap();
        assert_eq!(f.read(CONFIG_NAME), b"new");
        assert!(!f.has(&format!("{CONFIG_NAME}.tmp")));
    }
}
