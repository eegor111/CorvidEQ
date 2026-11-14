// Release builds are a normal windowed app (no extra console window on Windows).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    corvid_eq_lib::run()
}
