fn main() {
    // The icon is compiled into the exe, but tauri_build doesn't watch it:
    // without this line a new icon.ico never reaches the dev build.
    println!("cargo:rerun-if-changed=icons/icon.ico");
    tauri_build::build()
}
