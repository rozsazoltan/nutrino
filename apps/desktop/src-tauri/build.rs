use std::{env, process::Command};

fn git_short_commit() -> String {
    if let Ok(value) = env::var("NUTRINO_GIT_COMMIT") {
        let trimmed = value.trim();
        if trimmed.len() >= 7 && trimmed.chars().all(|ch| ch.is_ascii_hexdigit()) {
            return trimmed.chars().take(12).collect();
        }
    }
    if let Ok(value) = env::var("GITHUB_SHA") {
        let trimmed = value.trim();
        if trimmed.len() >= 7 && trimmed.chars().all(|ch| ch.is_ascii_hexdigit()) {
            return trimmed.chars().take(12).collect();
        }
    }
    Command::new("git")
        .args(["rev-parse", "--short=12", "HEAD"])
        .output()
        .ok()
        .and_then(|output| {
            if !output.status.success() {
                return None;
            }
            String::from_utf8(output.stdout).ok()
        })
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "local".to_string())
}

fn app_channel() -> String {
    for key in ["NUTRINO_APP_CHANNEL", "VITE_NUTRINO_CHANNEL"] {
        if let Ok(value) = env::var(key) {
            let normalized = value.trim().to_lowercase();
            if normalized == "dev" || normalized == "stable" {
                return normalized;
            }
        }
    }
    if env::var("PROFILE").map(|value| value == "debug").unwrap_or(false) {
        "dev".to_string()
    } else {
        "stable".to_string()
    }
}

fn main() {
    println!("cargo:rerun-if-env-changed=NUTRINO_APP_CHANNEL");
    println!("cargo:rerun-if-env-changed=VITE_NUTRINO_CHANNEL");
    println!("cargo:rerun-if-env-changed=NUTRINO_GIT_COMMIT");
    println!("cargo:rerun-if-env-changed=GITHUB_SHA");

    let channel = app_channel();
    let release_version = env::var("CARGO_PKG_VERSION").unwrap_or_else(|_| "0.0.0".to_string());
    let app_version = if channel == "dev" {
        format!("0.0.0-dev-{}", git_short_commit())
    } else {
        release_version
    };

    println!("cargo:rustc-env=NUTRINO_APP_CHANNEL={channel}");
    println!("cargo:rustc-env=NUTRINO_APP_VERSION={app_version}");

    tauri_build::build()
}
