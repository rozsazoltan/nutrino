use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            write_mobile_backup_file,
            read_mobile_backup_file,
            export_mobile_backup_via_android_picker,
            import_mobile_backup_via_android_picker,
        ]);

    #[cfg(mobile)]
    let builder = builder.plugin(tauri_plugin_share::init());

    #[cfg(target_os = "android")]
    let builder = builder.plugin(tauri_plugin_android_fs::init());

    builder
        .run(tauri::generate_context!())
        .expect("error while running nutrino mobile");
}

fn validate_zip_bytes(bytes: &[u8]) -> Result<(), String> {
    if bytes.len() < 22 || bytes.first() != Some(&0x50) || bytes.get(1) != Some(&0x4b) {
        return Err("Invalid ZIP bytes".to_string());
    }
    Ok(())
}

fn safe_zip_filename(filename: String) -> String {
    let safe_name = filename
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() || matches!(ch, '.' | '-' | '_') { ch } else { '-' })
        .collect::<String>();

    let safe_name = if safe_name.trim().is_empty() {
        "nutrino-mobile-app-backup.zip".to_string()
    } else {
        safe_name
    };

    if safe_name.to_ascii_lowercase().ends_with(".zip") {
        safe_name
    } else {
        format!("{safe_name}.zip")
    }
}

#[tauri::command]
fn write_mobile_backup_file(app: tauri::AppHandle, filename: String, bytes: Vec<u8>) -> Result<String, String> {
    validate_zip_bytes(&bytes)?;

    let safe_name = safe_zip_filename(filename);
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not resolve app data directory: {error}"))?
        .join("exports");
    std::fs::create_dir_all(&dir).map_err(|error| format!("Could not create backup export directory: {error}"))?;

    let path = dir.join(safe_name);
    std::fs::write(&path, &bytes).map_err(|error| format!("Could not write backup ZIP: {error}"))?;

    let saved = std::fs::read(&path).map_err(|error| format!("Could not verify backup ZIP: {error}"))?;
    if saved.len() != bytes.len() || saved.first() != Some(&0x50) || saved.get(1) != Some(&0x4b) {
        let _ = std::fs::remove_file(&path);
        return Err(format!("Backup ZIP verification failed: saved {} B, expected {} B", saved.len(), bytes.len()));
    }

    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
fn read_mobile_backup_file(path: String) -> Result<Vec<u8>, String> {
    let bytes = std::fs::read(&path).map_err(|error| format!("Could not read backup ZIP: {error}"))?;
    validate_zip_bytes(&bytes)?;
    Ok(bytes)
}

#[tauri::command]
fn export_mobile_backup_via_android_picker(app: tauri::AppHandle, filename: String, bytes: Vec<u8>) -> Result<String, String> {
    validate_zip_bytes(&bytes)?;
    let safe_name = safe_zip_filename(filename);

    #[cfg(target_os = "android")]
    {
        use std::io::{Read, Write};
        use tauri_plugin_android_fs::AndroidFsExt;

        let api = app.android_fs();
        let selected_path = api
            .file_picker()
            .save_file(None, &safe_name, Some("application/zip"), false)
            .map_err(|error| format!("Android save picker failed: {error}"))?;

        let Some(selected_path) = selected_path else {
            return Err("EXPORT_CANCELED".to_string());
        };

        {
            let mut file = api
                .open_file_writable(&selected_path)
                .map_err(|error| format!("Could not open selected backup file for writing: {error}"))?;
            file.write_all(&bytes)
                .map_err(|error| format!("Could not write selected backup ZIP: {error}"))?;
            file.flush()
                .map_err(|error| format!("Could not flush selected backup ZIP: {error}"))?;
            let _ = file.sync_all();
        }

        let mut saved = Vec::new();
        {
            let mut file = api
                .open_file_readable(&selected_path)
                .map_err(|error| format!("Could not reopen selected backup ZIP: {error}"))?;
            file.read_to_end(&mut saved)
                .map_err(|error| format!("Could not verify selected backup ZIP: {error}"))?;
        }

        validate_zip_bytes(&saved)?;
        if saved.len() != bytes.len() {
            return Err(format!("Backup ZIP verification failed: saved {} B, expected {} B", saved.len(), bytes.len()));
        }

        return Ok(format!("{} B", saved.len()));
    }

    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        let _ = safe_name;
        Err("Android save picker is only available on Android builds".to_string())
    }
}

#[tauri::command]
fn import_mobile_backup_via_android_picker(app: tauri::AppHandle) -> Result<Option<Vec<u8>>, String> {
    #[cfg(target_os = "android")]
    {
        use std::io::Read;
        use tauri_plugin_android_fs::AndroidFsExt;

        let api = app.android_fs();
        let selected_path = api
            .file_picker()
            .pick_file(
                None,
                &[
                    "application/zip",
                    "application/x-zip-compressed",
                    "application/octet-stream",
                    "*/*",
                ],
                false,
            )
            .map_err(|error| format!("Android open picker failed: {error}"))?;

        let Some(selected_path) = selected_path else {
            return Ok(None);
        };

        let mut bytes = Vec::new();
        {
            let mut file = api
                .open_file_readable(&selected_path)
                .map_err(|error| format!("Could not open selected backup ZIP: {error}"))?;
            file.read_to_end(&mut bytes)
                .map_err(|error| format!("Could not read selected backup ZIP: {error}"))?;
        }

        validate_zip_bytes(&bytes)?;
        Ok(Some(bytes))
    }

    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Err("Android open picker is only available on Android builds".to_string())
    }
}
