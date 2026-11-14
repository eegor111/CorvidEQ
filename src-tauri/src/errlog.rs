//! A small error log, for bug reports: a release build has no console, so
//! without this a crash leaves nothing behind.
//!
//! One text file, `corvid-eq.log`, in the app's own data folder. Past
//! `MAX_BYTES` it becomes `corvid-eq.old.log` and a new one starts, so the two
//! together stay small however long the app runs.
//!
//! Standard library only, and `write` never panics: the panic hook calls it,
//! and it must work before Tauri has started (the uninstaller's `--release-eapo`).

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

/// The app's data folder is named after `identifier` in `tauri.conf.json`.
/// Fixed here because the panic hook has no app handle to ask.
const APP_FOLDER: &str = "com.igormitrovic.corvideq";
const LOG_NAME: &str = "corvid-eq.log";
const OLD_LOG_NAME: &str = "corvid-eq.old.log";
const LAST_CRASH_NAME: &str = "last-crash.txt";
const MAX_BYTES: u64 = 1_000_000;

/// The app's own local data folder (`%LOCALAPPDATA%\com.igormitrovic.corvideq`).
/// Disabled under `cargo test` so tests never touch real user data.
pub(crate) fn app_dir() -> Option<PathBuf> {
    if cfg!(test) {
        return None;
    }
    std::env::var_os("LOCALAPPDATA").map(|dir| PathBuf::from(dir).join(APP_FOLDER))
}

fn log_dir() -> Option<PathBuf> {
    app_dir().map(|dir| dir.join("logs"))
}

/// Add one line to the log (and the console, for `tauri dev`).
pub fn write(message: &str) {
    let _ = writeln!(std::io::stderr(), "{message}");
    // Tests fake failures on purpose; those must not land in the user's real log.
    if cfg!(test) {
        return;
    }
    let Some(dir) = log_dir() else { return };
    if fs::create_dir_all(&dir).is_err() {
        return;
    }
    let path = dir.join(LOG_NAME);
    if fs::metadata(&path).is_ok_and(|m| m.len() > MAX_BYTES) {
        let _ = fs::rename(&path, dir.join(OLD_LOG_NAME));
    }
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&path) {
        let _ = writeln!(file, "{} {message}", timestamp());
    }
}

/// The time now, in UTC. Days to a calendar date is Howard Hinnant's
/// `civil_from_days`: a few lines here instead of a date library.
fn timestamp() -> String {
    let secs = SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs()) as i64;
    let (days, rest) = (secs / 86_400, secs % 86_400);
    let z = days + 719_468;
    let (era, day_of_era) = (z / 146_097, z % 146_097);
    let year_of_era = (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let shifted_month = (5 * day_of_year + 2) / 153; // March = 0
    let day = day_of_year - (153 * shifted_month + 2) / 5 + 1;
    let month = if shifted_month < 10 { shifted_month + 3 } else { shifted_month - 9 };
    let year = year_of_era + era * 400 + i64::from(month <= 2);
    format!("{year}-{month:02}-{day:02} {:02}:{:02}:{:02} UTC", rest / 3600, rest % 3600 / 60, rest % 60)
}

/// Save the last crash so the UI can show it once on next launch.
pub fn record_crash(message: &str) {
    let Some(dir) = app_dir() else { return };
    if fs::create_dir_all(&dir).is_err() {
        return;
    }
    let _ = fs::write(dir.join(LAST_CRASH_NAME), format!("{} {message}\n", timestamp()));
}

/// Read and clear the last crash marker so it is only shown once.
#[tauri::command]
pub fn take_last_crash() -> Option<String> {
    let path = app_dir()?.join(LAST_CRASH_NAME);
    let text = fs::read_to_string(&path).ok()?;
    let _ = fs::remove_file(&path);
    let trimmed = text.trim();
    (!trimmed.is_empty()).then(|| trimmed.to_string())
}

/// The UI's errors (`state/error-log.ts`).
#[tauri::command]
pub fn log_error(text: String) {
    write(&text);
}

/// Open the log's folder in Windows Explorer (made first: no errors yet = no folder).
#[tauri::command]
pub fn open_log_folder() -> Result<(), String> {
    let dir = log_dir().ok_or("Couldn't tell where the log folder is")?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    std::process::Command::new("explorer")
        .arg(&dir)
        .spawn()
        .map_err(|e| format!("Failed to open Explorer: {e}"))?;
    Ok(())
}
