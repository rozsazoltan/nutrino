fn main() {
    println!("cargo:rerun-if-env-changed=WRY_ANDROID_PACKAGE");
    println!("cargo:rerun-if-env-changed=WRY_ANDROID_LIBRARY");
    println!("cargo:rerun-if-env-changed=WRY_ANDROID_KOTLIN_FILES_OUT_DIR");
    println!("cargo:rerun-if-env-changed=TAURI_ANDROID_PACKAGE_UNESCAPED");
    println!("cargo:rerun-if-env-changed=NUTRINO_ANDROID_CHANNEL");
    tauri_build::build()
}
