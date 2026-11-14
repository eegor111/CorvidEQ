//! CorvidEQ desktop backend.
//!
//! The interface is the same React app as the browser version. Rust only does
//! what a web page isn't allowed to:
//! - `spectrum`: listen to what the computer plays, for the live analyzer.
//! - `devices`: list the audio outputs and inputs, with what decides what the analyzer
//!   hears (hardware or software volume, where Equalizer APO is loaded), and
//!   read the Windows volume live so the capture can undo it.
//! - `eapo`: write CorvidEQ's own file (`corvid-eq.txt`) into Equalizer APO's
//!   config folder, and switch Equalizer APO over to it (and back) when the
//!   user asks, keeping an exact copy of their previous `config.txt`.
//! - `errlog`: a small error log file, since a release build has no console.

mod devices;
mod eapo;
mod errlog;
mod spectrum;
mod tray;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // The uninstaller's last call (windows/hooks.nsh): switch CorvidEQ off
    // and quit, no window. Before the single-instance check, so it works
    // while the app is still open.
    if std::env::args().any(|a| a == "--release-eapo") {
        eapo::release_on_uninstall();
        tray::remove_startup_on_uninstall();
        return;
    }

    // If the app crashes, record it for the next launch without touching
    // Equalizer APO's config.txt so sound keeps running undisturbed.
    let default_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let thread = std::thread::current();
        let msg = format!("Crash on thread {}: {info}", thread.name().unwrap_or("unnamed"));
        errlog::write(&msg);
        errlog::record_crash(&msg);
        default_hook(info);
    }));

    tauri::Builder::default()
        // First: a second copy would fight this one over the same files, so
        // starting the app again just brings this window to the front.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            tray::show_main(app);
        }))
        // The Save window for "Save file" (export).
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            tray::init(app)?;
            Ok(())
        })
        .on_window_event(tray::on_window_event)
        .manage(spectrum::SpectrumState::default())
        .invoke_handler(tauri::generate_handler![
            spectrum::start_spectrum,
            spectrum::stop_spectrum,
            spectrum::set_analyzer_side,
            spectrum::set_analyzer_balance,
            devices::audio_devices,
            eapo::eapo_status,
            eapo::eapo_set_config_dir,
            eapo::open_config_folder,
            eapo::write_eq_file,
            eapo::eapo_switch_on,
            eapo::eapo_switch_off,
            eapo::export_config,
            eapo::open_source_website,
            eapo::open_issues_website,
            eapo::open_fft_video,
            errlog::log_error,
            errlog::open_log_folder,
            errlog::take_last_crash,
            tray::set_tray_behavior,
            tray::is_window_hidden,
            tray::get_startup_state,
            tray::set_startup_state
        ])
        .run(tauri::generate_context!())
        .expect("error while running CorvidEQ");
}
