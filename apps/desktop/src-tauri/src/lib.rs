use std::{
    collections::{HashMap, HashSet},
    net::{IpAddr, Ipv4Addr, SocketAddr},
    path::{Path, PathBuf},
    sync::Mutex,
};

use anyhow::{anyhow, Context, Result};
use axum::{
    extract::{Query, State as AxumState},
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::{Manager, PhysicalPosition, PhysicalSize, State, WindowEvent};
use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tokio::sync::oneshot;
use tower_http::cors::{Any, CorsLayer};
use uuid::Uuid;

const APP_NAME: &str = "Nutrino Desktop";
const APP_VERSION: &str = "0.8.0";

struct ServerRuntime {
    port: u16,
    shutdown: Option<oneshot::Sender<()>>,
}

struct AppState {
    db_path: PathBuf,
    server: Mutex<Option<ServerRuntime>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct DesktopSettings {
    remember_window_state: bool,
    launch_at_startup: bool,
    run_in_background: bool,
    auto_start_server: bool,
    close_to_tray: bool,
    start_hidden_to_tray: bool,
    window_x: Option<i32>,
    window_y: Option<i32>,
    window_width: Option<u32>,
    window_height: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ServerStatus {
    running: bool,
    bind_address: Option<String>,
    port: Option<u16>,
    base_url: Option<String>,
    token: String,
    password_set: bool,
    app_channel: String,
    source_id: String,
    auth_required: bool,
    dev_mode: bool,
    catalog_revision: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct HealthResponse {
    ok: bool,
    name: String,
    app: String,
    source_id: String,
    version: String,
    auth_required: bool,
    app_channel: String,
    dev_mode: bool,
    catalog_revision: i64,
}


#[derive(Debug, Clone, Serialize, Deserialize)]
struct CatalogAlias {
    kind: String,
    alias_id: String,
    canonical_id: String,
    source_id: Option<String>,
    updated_at: i64,
}

fn default_food_catalog_kind() -> String { "food".into() }

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SyncInboxSummary {
    foods: usize,
    recipes: usize,
    recipe_items: usize,
    activities: usize,
    intakes: usize,
    weight_logs: usize,
    activity_logs: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct MergeCandidate {
    kind: String,
    incoming_id: String,
    incoming_name: String,
    canonical_id: String,
    canonical_name: String,
}

#[derive(Debug, Clone, Serialize)]
struct CatalogDuplicateItem {
    id: String,
    name: String,
    subtitle: String,
    updated_at: i64,
}

#[derive(Debug, Clone, Serialize)]
struct CatalogDuplicateSuggestion {
    kind: String,
    reason: String,
    confidence: String,
    score: u8,
    key: String,
    items: Vec<CatalogDuplicateItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SyncInboxEntry {
    id: String,
    source_id: String,
    device_name: Option<String>,
    received_at: i64,
    status: String,
    summary: SyncInboxSummary,
    merge_candidates: Vec<MergeCandidate>,
    payload: SyncPushRequest,
}

#[derive(Debug, Clone, Serialize)]
struct SyncInboxCommitResult {
    accepted: bool,
    merged: usize,
    inserted_or_updated: usize,
    intakes: usize,
    weight_logs: usize,
    activity_logs: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Food {
    id: String,
    source_id: String,
    name: String,
    brand: Option<String>,
    #[serde(default = "default_food_catalog_kind")]
    catalog_kind: String,
    note: Option<String>,
    barcode: Option<String>,
    default_unit: String,
    serving_size_g: Option<f64>,
    kcal_per_100g: f64,
    carbs_per_100g: f64,
    fat_per_100g: f64,
    protein_per_100g: f64,
    sugars_per_100g: f64,
    fiber_per_100g: f64,
    salt_per_100g: f64,
    updated_at: i64,
    deleted_at: Option<i64>,
}

#[derive(Debug, Clone, Deserialize)]
struct FoodInput {
    id: Option<String>,
    name: String,
    brand: Option<String>,
    catalog_kind: Option<String>,
    note: Option<String>,
    barcode: Option<String>,
    default_unit: Option<String>,
    serving_size_g: Option<f64>,
    kcal_per_100g: f64,
    carbs_per_100g: f64,
    fat_per_100g: f64,
    protein_per_100g: f64,
    sugars_per_100g: Option<f64>,
    fiber_per_100g: Option<f64>,
    salt_per_100g: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Recipe {
    id: String,
    source_id: String,
    name: String,
    description: Option<String>,
    note: Option<String>,
    total_weight_g: Option<f64>,
    servings_count: Option<f64>,
    updated_at: i64,
    deleted_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct RecipeItem {
    id: String,
    recipe_id: String,
    food_id: String,
    amount_g: f64,
    updated_at: i64,
    deleted_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
struct RecipeItemDetail {
    id: String,
    recipe_id: String,
    food_id: String,
    food_name: String,
    amount_g: f64,
    kcal: f64,
    carbs: f64,
    fat: f64,
    protein: f64,
}

#[derive(Debug, Clone, Serialize)]
struct RecipeNutrition {
    total_weight_g: f64,
    kcal_total: f64,
    kcal_per_100g: f64,
    carbs_per_100g: f64,
    fat_per_100g: f64,
    protein_per_100g: f64,
}

#[derive(Debug, Clone, Serialize)]
struct RecipeDetail {
    recipe: Recipe,
    items: Vec<RecipeItemDetail>,
    nutrition: RecipeNutrition,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct RecipeInputItem {
    food_id: String,
    amount_g: f64,
}

#[derive(Debug, Clone, Deserialize)]
struct RecipeInput {
    id: Option<String>,
    name: String,
    description: Option<String>,
    note: Option<String>,
    total_weight_g: Option<f64>,
    servings_count: Option<f64>,
    items: Vec<RecipeInputItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct IntakePayload {
    id: String,
    item_type: Option<String>,
    food_id: String,
    source_id: String,
    consumed_at: i64,
    meal_type: String,
    amount_g: f64,
    food_snapshot_json: String,
    note_title: Option<String>,
    note_description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct WeightLogPayload {
    id: String,
    measured_at: i64,
    weight_kg: f64,
    bmi: Option<f64>,
    source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ActivityDefinition {
    id: String,
    code: String,
    name: String,
    description: Option<String>,
    activity_type: String,
    met: f64,
    kcal_per_min: f64,
    updated_at: i64,
    deleted_at: Option<i64>,
}

#[derive(Debug, Clone, Deserialize)]
struct ActivityInput {
    id: Option<String>,
    code: Option<String>,
    name: String,
    description: Option<String>,
    activity_type: Option<String>,
    met: f64,
    kcal_per_min: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ActivityLogPayload {
    id: String,
    activity_id: Option<String>,
    activity_name: String,
    performed_at: i64,
    duration_min: f64,
    kcal: f64,
    source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SyncPullResponse {
    server_time: i64,
    source_id: String,
    foods: Vec<Food>,
    recipes: Vec<Recipe>,
    recipe_items: Vec<RecipeItem>,
    activities: Vec<ActivityDefinition>,
    aliases: Vec<CatalogAlias>,
}

#[derive(Debug, Clone, Deserialize)]
struct SyncPullQuery {
    since: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SyncPushRequest {
    source_id: Option<String>,
    device_name: Option<String>,
    sent_at: Option<i64>,
    foods: Option<Vec<Food>>,
    recipes: Option<Vec<Recipe>>,
    recipe_items: Option<Vec<RecipeItem>>,
    activities: Option<Vec<ActivityDefinition>>,
    intakes: Vec<IntakePayload>,
    weight_logs: Vec<WeightLogPayload>,
    activity_logs: Vec<ActivityLogPayload>,
}

#[derive(Debug, Clone, Serialize)]
struct SyncPushResponse {
    accepted: bool,
    server_time: i64,
}

#[derive(Debug, Clone, Serialize)]
struct ImportPreview {
    total_rows: usize,
    valid_rows: usize,
    invalid_rows: usize,
    rows: Vec<ImportPreviewRow>,
}

#[derive(Debug, Clone, Serialize)]
struct ImportPreviewRow {
    row_number: usize,
    food: Option<Food>,
    errors: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
struct ImportCommitResult {
    inserted_or_updated: usize,
    skipped: usize,
    errors: Vec<String>,
}

#[derive(Debug, Clone)]
struct ApiState {
    db_path: PathBuf,
    token: String,
    source_id: String,
    auth_required: bool,
    dev_mode: bool,
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            let db_path = database_path(app.handle())?;
            init_database(&db_path)?;
            app.manage(AppState {
                db_path: db_path.clone(),
                server: Mutex::new(None),
            });

            if let Some(window) = app.get_webview_window("main") {
                if let Ok(settings) = read_desktop_settings(&db_path) {
                    if settings.remember_window_state {
                        if let (Some(width), Some(height)) = (settings.window_width, settings.window_height) {
                            let _ = window.set_size(PhysicalSize::new(width, height));
                        }
                        if let (Some(x), Some(y)) = (settings.window_x, settings.window_y) {
                            let _ = window.set_position(PhysicalPosition::new(x, y));
                        }
                    }

                    let launched_hidden = std::env::args().any(|arg| arg == "--hidden" || arg == "--tray");
                    if launched_hidden && settings.run_in_background && settings.start_hidden_to_tray {
                        let _ = window.hide();
                    }
                }
            }

            let show_item = MenuItemBuilder::with_id("show", "Open Nutrino").build(app)?;
            let start_server_item = MenuItemBuilder::with_id("start_server", "Start server").build(app)?;
            let stop_server_item = MenuItemBuilder::with_id("stop_server", "Stop server").build(app)?;
            let quit_item = MenuItemBuilder::with_id("quit", "Quit Nutrino").build(app)?;
            let tray_menu = MenuBuilder::new(app)
                .items(&[&show_item, &start_server_item, &stop_server_item, &quit_item])
                .build()?;

            let tray_builder = TrayIconBuilder::new()
                .tooltip("nutrino Desktop")
                .menu(&tray_menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "start_server" => {
                        let app_handle = app.clone();
                        tauri::async_runtime::spawn(async move {
                            let state = app_handle.state::<AppState>();
                            let port = read_string_setting(&state.db_path, "server_port")
                                .ok()
                                .and_then(|value| value.parse().ok())
                                .unwrap_or(8090);
                            if let Err(err) = start_api_server_internal(port, &state).await {
                                eprintln!("Failed to start nutrino API server from tray: {err}");
                            }
                        });
                    }
                    "stop_server" => {
                        let state = app.state::<AppState>();
                        if let Err(err) = stop_api_server_internal(&state) {
                            eprintln!("Failed to stop nutrino API server from tray: {err}");
                        }
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                });
            let tray_builder = if let Some(icon) = app.default_window_icon() { tray_builder.icon(icon.clone()) } else { tray_builder };
            let _ = tray_builder.build(app);

            if read_bool_setting(&db_path, "auto_start_server", false).unwrap_or(false) {
                let app_handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    let state = app_handle.state::<AppState>();
                    let port = read_string_setting(&state.db_path, "server_port").ok().and_then(|v| v.parse().ok()).unwrap_or(8090);
                    let _ = start_api_server_internal(port, &state).await;
                });
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let state = window.app_handle().state::<AppState>();
                let run_in_background = read_bool_setting(&state.db_path, "run_in_background", false).unwrap_or(false);
                let close_to_tray = read_bool_setting(&state.db_path, "close_to_tray", false).unwrap_or(false);
                if run_in_background && close_to_tray {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_server_status,
            start_api_server,
            stop_api_server,
            list_foods,
            save_food,
            delete_food,
            export_foods_csv,
            import_foods_preview,
            import_foods_commit,
            list_recipes,
            save_recipe,
            delete_recipe,
            export_recipes_csv,
            import_recipes_csv,
            list_activities,
            save_activity,
            delete_activity,
            export_activities_csv,
            import_activities_csv,
            get_desktop_settings,
            save_desktop_settings,
            remember_current_window,
            set_server_password,
            list_sync_inbox,
            accept_sync_inbox,
            reject_sync_inbox,
            update_sync_inbox_payload,
            merge_catalog_item,
            list_catalog_duplicate_suggestions,
        ])
        .run(tauri::generate_context!())
        .expect("error while running nutrino Desktop");
}

fn database_path(app: &tauri::AppHandle) -> Result<PathBuf> {
    let dir = app
        .path()
        .app_data_dir()
        .context("failed to resolve app data directory")?;
    std::fs::create_dir_all(&dir)?;
    Ok(dir.join("nutrino-desktop.sqlite"))
}

fn now_ms() -> i64 {
    Utc::now().timestamp_millis()
}

fn init_database(path: &Path) -> Result<()> {
    let conn = Connection::open(path)?;
    conn.execute_batch(
        r#"
        PRAGMA journal_mode = WAL;
        PRAGMA foreign_keys = ON;

        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS foods (
            id TEXT PRIMARY KEY,
            source_id TEXT NOT NULL,
            name TEXT NOT NULL,
            brand TEXT,
            catalog_kind TEXT NOT NULL DEFAULT 'food',
            note TEXT,
            barcode TEXT,
            default_unit TEXT NOT NULL DEFAULT 'g',
            serving_size_g REAL,
            kcal_per_100g REAL NOT NULL,
            carbs_per_100g REAL NOT NULL,
            fat_per_100g REAL NOT NULL,
            protein_per_100g REAL NOT NULL,
            sugars_per_100g REAL NOT NULL DEFAULT 0,
            fiber_per_100g REAL NOT NULL DEFAULT 0,
            salt_per_100g REAL NOT NULL DEFAULT 0,
            updated_at INTEGER NOT NULL,
            deleted_at INTEGER
        );

        CREATE TABLE IF NOT EXISTS recipes (
            id TEXT PRIMARY KEY,
            source_id TEXT NOT NULL,
            name TEXT NOT NULL,
            description TEXT,
            note TEXT,
            total_weight_g REAL,
            servings_count REAL,
            updated_at INTEGER NOT NULL,
            deleted_at INTEGER
        );

        CREATE TABLE IF NOT EXISTS recipe_items (
            id TEXT PRIMARY KEY,
            recipe_id TEXT NOT NULL,
            food_id TEXT NOT NULL,
            amount_g REAL NOT NULL,
            updated_at INTEGER NOT NULL,
            deleted_at INTEGER
        );

        CREATE TABLE IF NOT EXISTS intakes (
            id TEXT PRIMARY KEY,
            source_id TEXT NOT NULL,
            item_type TEXT NOT NULL DEFAULT 'food',
            food_id TEXT NOT NULL,
            consumed_at INTEGER NOT NULL,
            meal_type TEXT NOT NULL,
            amount_g REAL NOT NULL,
            food_snapshot_json TEXT NOT NULL,
            note_title TEXT,
            note_description TEXT,
            synced_at INTEGER,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS weight_logs (
            id TEXT PRIMARY KEY,
            measured_at INTEGER NOT NULL,
            weight_kg REAL NOT NULL,
            bmi REAL NOT NULL DEFAULT 0,
            source TEXT NOT NULL,
            synced_at INTEGER,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS activities (
            id TEXT PRIMARY KEY,
            code TEXT NOT NULL,
            name TEXT NOT NULL,
            description TEXT,
            activity_type TEXT NOT NULL,
            met REAL NOT NULL,
            kcal_per_min REAL NOT NULL,
            updated_at INTEGER NOT NULL,
            deleted_at INTEGER
        );

        CREATE TABLE IF NOT EXISTS activity_logs (
            id TEXT PRIMARY KEY,
            activity_id TEXT,
            activity_name TEXT NOT NULL,
            performed_at INTEGER NOT NULL,
            duration_min REAL NOT NULL,
            kcal REAL NOT NULL,
            source TEXT NOT NULL,
            synced_at INTEGER,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );


        CREATE TABLE IF NOT EXISTS item_aliases (
            kind TEXT NOT NULL,
            alias_id TEXT NOT NULL,
            canonical_id TEXT NOT NULL,
            source_id TEXT,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY (kind, alias_id)
        );

        CREATE TABLE IF NOT EXISTS sync_inbox (
            id TEXT PRIMARY KEY,
            source_id TEXT NOT NULL,
            device_name TEXT,
            received_at INTEGER NOT NULL,
            payload_json TEXT NOT NULL,
            summary_json TEXT NOT NULL,
            merge_candidates_json TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            applied_at INTEGER
        );
        "#,
    )?;

    let _ = conn.execute("ALTER TABLE weight_logs ADD COLUMN bmi REAL NOT NULL DEFAULT 0", []);
    let _ = conn.execute("ALTER TABLE foods ADD COLUMN catalog_kind TEXT NOT NULL DEFAULT 'food'", []);
    let _ = conn.execute("ALTER TABLE foods ADD COLUMN note TEXT", []);
    let _ = conn.execute("ALTER TABLE foods ADD COLUMN barcode TEXT", []);
    let _ = conn.execute("ALTER TABLE recipes ADD COLUMN note TEXT", []);
    let _ = conn.execute("ALTER TABLE intakes ADD COLUMN item_type TEXT NOT NULL DEFAULT 'food'", []);
    let _ = conn.execute("ALTER TABLE intakes ADD COLUMN note_title TEXT", []);
    let _ = conn.execute("ALTER TABLE intakes ADD COLUMN note_description TEXT", []);
    retire_builtin_sample_catalog(&conn)?;
    seed_default_activities(&conn)?;

    ensure_setting(&conn, "source_id", &format!("desktop-{}", Uuid::new_v4()))?;
    migrate_server_password(&conn)?;
    ensure_setting(&conn, "server_port", "8090")?;
    ensure_setting(&conn, "remember_window_state", "false")?;
    ensure_setting(&conn, "launch_at_startup", "false")?;
    ensure_setting(&conn, "run_in_background", "false")?;
    ensure_setting(&conn, "auto_start_server", "false")?;
    ensure_setting(&conn, "close_to_tray", "false")?;
    ensure_setting(&conn, "start_hidden_to_tray", "false")?;
    Ok(())
}


fn retire_builtin_sample_catalog(conn: &Connection) -> Result<()> {
    let now = now_ms();
    conn.execute(
        r#"
        UPDATE recipe_items
        SET deleted_at = ?1, updated_at = ?1
        WHERE deleted_at IS NULL
          AND recipe_id IN (SELECT id FROM recipes WHERE source_id = 'nutrino-default')
        "#,
        params![now],
    )?;
    conn.execute(
        "UPDATE recipes SET deleted_at = ?1, updated_at = ?1 WHERE source_id = 'nutrino-default' AND deleted_at IS NULL",
        params![now],
    )?;
    conn.execute(
        "UPDATE foods SET deleted_at = ?1, updated_at = ?1 WHERE source_id = 'nutrino-default' AND deleted_at IS NULL",
        params![now],
    )?;
    Ok(())
}

fn ensure_setting(conn: &Connection, key: &str, default_value: &str) -> Result<()> {
    let existing: Option<String> = conn
        .query_row("SELECT value FROM settings WHERE key = ?1", [key], |row| row.get(0))
        .optional()?;
    if existing.is_none() {
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)",
            params![key, default_value],
        )?;
    }
    Ok(())
}


fn migrate_server_password(conn: &Connection) -> Result<()> {
    let existing_password: Option<String> = conn
        .query_row("SELECT value FROM settings WHERE key = 'server_password'", [], |row| row.get(0))
        .optional()?;
    if existing_password.is_none() {
        let old_token: Option<String> = conn
            .query_row("SELECT value FROM settings WHERE key = 'server_token'", [], |row| row.get(0))
            .optional()?;
        let value = old_token.unwrap_or_default();
        conn.execute(
            "INSERT INTO settings (key, value) VALUES ('server_password', ?1)",
            params![value],
        )?;
    }
    Ok(())
}

fn setting(conn: &Connection, key: &str) -> Result<String> {
    conn.query_row("SELECT value FROM settings WHERE key = ?1", [key], |row| row.get(0))
        .with_context(|| format!("missing setting {key}"))
}

fn set_setting(conn: &Connection, key: &str, value: &str) -> Result<()> {
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )?;
    Ok(())
}

fn read_string_setting(path: &Path, key: &str) -> Result<String> {
    let conn = open_conn(path)?;
    setting(&conn, key)
}

fn read_bool_setting(path: &Path, key: &str, default_value: bool) -> Result<bool> {
    let conn = open_conn(path)?;
    let value = setting(&conn, key).unwrap_or_else(|_| default_value.to_string());
    Ok(matches!(value.as_str(), "true" | "1" | "yes" | "on"))
}

fn read_i32_setting(conn: &Connection, key: &str) -> Option<i32> {
    setting(conn, key).ok().and_then(|value| value.parse::<i32>().ok())
}

fn read_u32_setting(conn: &Connection, key: &str) -> Option<u32> {
    setting(conn, key).ok().and_then(|value| value.parse::<u32>().ok())
}

fn read_bool_from_conn(conn: &Connection, key: &str, default_value: bool) -> bool {
    setting(conn, key).map(|value| matches!(value.as_str(), "true" | "1" | "yes" | "on")).unwrap_or(default_value)
}

fn read_desktop_settings(path: &Path) -> Result<DesktopSettings> {
    let conn = open_conn(path)?;
    Ok(DesktopSettings {
        remember_window_state: read_bool_from_conn(&conn, "remember_window_state", false),
        launch_at_startup: read_bool_from_conn(&conn, "launch_at_startup", false),
        run_in_background: read_bool_from_conn(&conn, "run_in_background", false),
        auto_start_server: read_bool_from_conn(&conn, "auto_start_server", false),
        close_to_tray: read_bool_from_conn(&conn, "close_to_tray", false),
        start_hidden_to_tray: read_bool_from_conn(&conn, "start_hidden_to_tray", false),
        window_x: read_i32_setting(&conn, "window_x"),
        window_y: read_i32_setting(&conn, "window_y"),
        window_width: read_u32_setting(&conn, "window_width"),
        window_height: read_u32_setting(&conn, "window_height"),
    })
}

fn write_desktop_settings(path: &Path, settings: &DesktopSettings) -> Result<()> {
    let conn = open_conn(path)?;
    set_setting(&conn, "remember_window_state", &settings.remember_window_state.to_string())?;
    set_setting(&conn, "launch_at_startup", &settings.launch_at_startup.to_string())?;
    set_setting(&conn, "run_in_background", &settings.run_in_background.to_string())?;
    set_setting(&conn, "auto_start_server", &settings.auto_start_server.to_string())?;
    set_setting(&conn, "close_to_tray", &settings.close_to_tray.to_string())?;
    set_setting(&conn, "start_hidden_to_tray", &settings.start_hidden_to_tray.to_string())?;
    if let Some(value) = settings.window_x { set_setting(&conn, "window_x", &value.to_string())?; }
    if let Some(value) = settings.window_y { set_setting(&conn, "window_y", &value.to_string())?; }
    if let Some(value) = settings.window_width { set_setting(&conn, "window_width", &value.to_string())?; }
    if let Some(value) = settings.window_height { set_setting(&conn, "window_height", &value.to_string())?; }
    set_launch_at_startup(settings.launch_at_startup, settings.start_hidden_to_tray)?;
    Ok(())
}

#[cfg(windows)]
fn set_launch_at_startup(enabled: bool, start_hidden_to_tray: bool) -> Result<()> {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let (key, _) = hkcu.create_subkey("Software\\Microsoft\\Windows\\CurrentVersion\\Run")?;
    let name = "nutrino Desktop";
    if enabled {
        let exe = std::env::current_exe()?;
        let quoted = format!("\"{}\"", exe.to_string_lossy());
        let command = if start_hidden_to_tray { format!("{quoted} --hidden") } else { quoted };
        key.set_value(name, &command)?;
    } else {
        let _ = key.delete_value(name);
    }
    Ok(())
}

#[cfg(not(windows))]
fn set_launch_at_startup(_enabled: bool, _start_hidden_to_tray: bool) -> Result<()> { Ok(()) }

fn open_conn(path: &Path) -> Result<Connection> {
    let conn = Connection::open(path)?;
    conn.execute_batch("PRAGMA foreign_keys = ON;")?;
    Ok(conn)
}

#[tauri::command]
fn get_server_status(state: State<'_, AppState>) -> Result<ServerStatus, String> {
    server_status(&state).map_err(stringify_error)
}

#[tauri::command]
async fn start_api_server(port: u16, state: State<'_, AppState>) -> Result<ServerStatus, String> {
    start_api_server_internal(port, &state).await.map_err(stringify_error)
}

async fn start_api_server_internal(port: u16, state: &AppState) -> Result<ServerStatus> {
    if port < 1024 {
        return Err(anyhow!("Use an unprivileged port above 1023."));
    }

    {
        let guard = state.server.lock().map_err(|_| anyhow!("server lock poisoned"))?;
        if guard.is_some() {
            return server_status(state);
        }
    }

    let conn = open_conn(&state.db_path)?;
    set_setting(&conn, "server_port", &port.to_string())?;
    let token = setting(&conn, "server_password")?;
    let source_id = setting(&conn, "source_id")?;
    let auth_required = auth_required_for_token(&token);
    drop(conn);

    let api_state = ApiState {
        db_path: state.db_path.clone(),
        token,
        source_id,
        auth_required,
        dev_mode: dev_mode(),
    };

    let router = Router::new()
        .route("/api/v1/health", get(health))
        .route("/api/v1/sync/pull", get(sync_pull))
        .route("/api/v1/sync/push", post(sync_push))
        .route("/api/v1/foods", get(api_list_foods).post(api_create_food))
        .route("/api/v1/recipes", get(api_list_recipes))
        .route("/api/v1/activities", get(api_list_activities))
        .layer(CorsLayer::new().allow_origin(Any).allow_headers(Any).allow_methods(Any))
        .with_state(api_state);

    let addr = SocketAddr::new(IpAddr::V4(Ipv4Addr::UNSPECIFIED), port);
    let listener = tokio::net::TcpListener::bind(addr).await
        .with_context(|| format!("Failed to bind API server on port {port}"))?;

    let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();
    tauri::async_runtime::spawn(async move {
        let result = axum::serve(listener, router)
            .with_graceful_shutdown(async move { let _ = shutdown_rx.await; })
            .await;
        if let Err(err) = result { eprintln!("nutrino API server stopped with error: {err}"); }
    });

    let mut guard = state.server.lock().map_err(|_| anyhow!("server lock poisoned"))?;
    *guard = Some(ServerRuntime { port, shutdown: Some(shutdown_tx) });
    drop(guard);

    server_status(state)
}

#[tauri::command]
async fn stop_api_server(state: State<'_, AppState>) -> Result<ServerStatus, String> {
    stop_api_server_internal(&state).map_err(stringify_error)
}

fn stop_api_server_internal(state: &AppState) -> Result<ServerStatus> {
    let mut guard = state.server.lock().map_err(|_| anyhow!("server lock poisoned"))?;
    if let Some(mut runtime) = guard.take() {
        if let Some(shutdown) = runtime.shutdown.take() {
            let _ = shutdown.send(());
        }
    }
    drop(guard);
    server_status(state)
}

#[tauri::command]
fn list_foods(state: State<'_, AppState>) -> Result<Vec<Food>, String> {
    db_list_active_foods(&state.db_path).map_err(stringify_error)
}

#[tauri::command]
fn save_food(state: State<'_, AppState>, input: FoodInput) -> Result<Food, String> {
    let conn = open_conn(&state.db_path).map_err(stringify_error)?;
    let source_id = setting(&conn, "source_id").map_err(stringify_error)?;
    let food = food_from_input(input, source_id).map_err(stringify_error)?;
    upsert_food(&conn, &food).map_err(stringify_error)?;
    Ok(food)
}

#[tauri::command]
fn delete_food(state: State<'_, AppState>, food_id: String) -> Result<(), String> {
    let conn = open_conn(&state.db_path).map_err(stringify_error)?;
    let now = now_ms();
    conn.execute(
        "UPDATE foods SET deleted_at = ?1, updated_at = ?1 WHERE id = ?2",
        params![now, food_id],
    )
    .map_err(stringify_error)?;
    Ok(())
}

#[tauri::command]
fn export_foods_csv(state: State<'_, AppState>) -> Result<String, String> {
    let foods = db_list_active_foods(&state.db_path).map_err(stringify_error)?;
    let mut writer = csv::Writer::from_writer(Vec::new());
    writer
        .write_record([
            "id",
            "name",
            "brand",
            "catalog_kind",
            "note",
            "barcode",
            "default_unit",
            "serving_size_g",
            "kcal_per_100g",
            "carbs_per_100g",
            "fat_per_100g",
            "protein_per_100g",
            "sugars_per_100g",
            "fiber_per_100g",
            "salt_per_100g",
        ])
        .map_err(stringify_error)?;

    for food in foods {
        writer
            .write_record([
                food.id,
                food.name,
                food.brand.unwrap_or_default(),
                food.catalog_kind,
                food.note.unwrap_or_default(),
                food.barcode.unwrap_or_default(),
                food.default_unit,
                food.serving_size_g.map(|v| v.to_string()).unwrap_or_default(),
                food.kcal_per_100g.to_string(),
                food.carbs_per_100g.to_string(),
                food.fat_per_100g.to_string(),
                food.protein_per_100g.to_string(),
                food.sugars_per_100g.to_string(),
                food.fiber_per_100g.to_string(),
                food.salt_per_100g.to_string(),
            ])
            .map_err(stringify_error)?;
    }

    let bytes = writer.into_inner().map_err(stringify_error)?;
    String::from_utf8(bytes).map_err(stringify_error)
}

#[tauri::command]
fn import_foods_preview(state: State<'_, AppState>, csv_text: String) -> Result<ImportPreview, String> {
    parse_food_csv(&state.db_path, &csv_text).map_err(stringify_error)
}

#[tauri::command]
fn import_foods_commit(state: State<'_, AppState>, csv_text: String, skip_duplicates: Option<bool>) -> Result<ImportCommitResult, String> {
    let preview = parse_food_csv(&state.db_path, &csv_text).map_err(stringify_error)?;
    let conn = open_conn(&state.db_path).map_err(stringify_error)?;
    let mut inserted_or_updated = 0;
    let mut skipped = 0;
    let mut errors = vec![];

    for row in preview.rows {
        match (row.food, row.errors.is_empty()) {
            (Some(food), true) => {
                if skip_duplicates.unwrap_or(false) && find_existing_food_duplicate(&conn, &food).map_err(stringify_error)?.is_some() {
                    skipped += 1;
                    continue;
                }
                if let Err(err) = upsert_food(&conn, &food) {
                    errors.push(format!("Row {}: {err}", row.row_number));
                    skipped += 1;
                } else {
                    inserted_or_updated += 1;
                }
            }
            _ => skipped += 1,
        }
    }

    Ok(ImportCommitResult {
        inserted_or_updated,
        skipped,
        errors,
    })
}

#[tauri::command]
fn list_recipes(state: State<'_, AppState>) -> Result<Vec<RecipeDetail>, String> {
    db_list_recipe_details(&state.db_path).map_err(stringify_error)
}

#[tauri::command]
fn save_recipe(state: State<'_, AppState>, input: RecipeInput) -> Result<RecipeDetail, String> {
    let mut conn = open_conn(&state.db_path).map_err(stringify_error)?;
    let source_id = setting(&conn, "source_id").map_err(stringify_error)?;
    let now = now_ms();
    let recipe_id = input
        .id
        .filter(|id| !id.trim().is_empty())
        .unwrap_or_else(|| format!("recipe-{}", Uuid::new_v4()));
    let name = input.name.trim().to_string();
    if name.is_empty() {
        return Err("recipe name is required".into());
    }
    if input.items.is_empty() {
        return Err("add at least one ingredient".into());
    }

    let mut ingredient_weight = 0.0;
    for item in &input.items {
        if item.food_id.trim().is_empty() {
            return Err("ingredient food_id is required".into());
        }
        if item.amount_g <= 0.0 {
            return Err("ingredient amount must be greater than 0".into());
        }
        ingredient_weight += item.amount_g;
    }

    let total_weight = input.total_weight_g.filter(|value| value.is_finite() && *value > 0.0).unwrap_or(ingredient_weight);

    let tx = conn.transaction().map_err(stringify_error)?;
    tx.execute(
        r#"
        INSERT INTO recipes (id, source_id, name, description, note, total_weight_g, servings_count, updated_at, deleted_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, NULL)
        ON CONFLICT(id) DO UPDATE SET
            source_id = excluded.source_id,
            name = excluded.name,
            description = excluded.description,
            note = excluded.note,
            total_weight_g = excluded.total_weight_g,
            servings_count = excluded.servings_count,
            updated_at = excluded.updated_at,
            deleted_at = NULL
        "#,
        params![
            recipe_id,
            source_id,
            name,
            input.description.filter(|value| !value.trim().is_empty()),
            input.note.filter(|value| !value.trim().is_empty()),
            total_weight,
            input.servings_count,
            now
        ],
    )
    .map_err(stringify_error)?;

    tx.execute(
        "UPDATE recipe_items SET deleted_at = ?1, updated_at = ?1 WHERE recipe_id = ?2 AND deleted_at IS NULL",
        params![now, recipe_id],
    )
    .map_err(stringify_error)?;

    for item in input.items {
        tx.execute(
            r#"
            INSERT INTO recipe_items (id, recipe_id, food_id, amount_g, updated_at, deleted_at)
            VALUES (?1, ?2, ?3, ?4, ?5, NULL)
            "#,
            params![format!("recipe-item-{}", Uuid::new_v4()), recipe_id, item.food_id, item.amount_g, now],
        )
        .map_err(stringify_error)?;
    }
    tx.commit().map_err(stringify_error)?;

    db_recipe_detail(&state.db_path, &recipe_id).map_err(stringify_error)
}

#[tauri::command]
fn delete_recipe(state: State<'_, AppState>, recipe_id: String) -> Result<(), String> {
    let conn = open_conn(&state.db_path).map_err(stringify_error)?;
    let now = now_ms();
    conn.execute(
        "UPDATE recipes SET deleted_at = ?1, updated_at = ?1 WHERE id = ?2",
        params![now, recipe_id],
    )
    .map_err(stringify_error)?;
    conn.execute(
        "UPDATE recipe_items SET deleted_at = ?1, updated_at = ?1 WHERE recipe_id = ?2",
        params![now, recipe_id],
    )
    .map_err(stringify_error)?;
    Ok(())
}

#[tauri::command]
fn list_activities(state: State<'_, AppState>) -> Result<Vec<ActivityDefinition>, String> {
    db_list_active_activities(&state.db_path).map_err(stringify_error)
}

#[tauri::command]
fn save_activity(state: State<'_, AppState>, input: ActivityInput) -> Result<ActivityDefinition, String> {
    let conn = open_conn(&state.db_path).map_err(stringify_error)?;
    let activity = activity_from_input(input).map_err(stringify_error)?;
    upsert_activity(&conn, &activity).map_err(stringify_error)?;
    Ok(activity)
}

#[tauri::command]
fn delete_activity(state: State<'_, AppState>, activity_id: String) -> Result<(), String> {
    let conn = open_conn(&state.db_path).map_err(stringify_error)?;
    let now = now_ms();
    conn.execute(
        "UPDATE activities SET deleted_at = ?1, updated_at = ?1 WHERE id = ?2",
        params![now, activity_id],
    )
    .map_err(stringify_error)?;
    Ok(())
}

#[tauri::command]
fn get_desktop_settings(state: State<'_, AppState>) -> Result<DesktopSettings, String> {
    read_desktop_settings(&state.db_path).map_err(stringify_error)
}

#[tauri::command]
fn save_desktop_settings(state: State<'_, AppState>, settings: DesktopSettings) -> Result<DesktopSettings, String> {
    write_desktop_settings(&state.db_path, &settings).map_err(stringify_error)?;
    read_desktop_settings(&state.db_path).map_err(stringify_error)
}

#[tauri::command]
fn remember_current_window(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<DesktopSettings, String> {
    let Some(window) = app.get_webview_window("main") else { return Err("main window not found".into()); };
    let mut settings = read_desktop_settings(&state.db_path).map_err(stringify_error)?;
    if let Ok(pos) = window.outer_position() {
        settings.window_x = Some(pos.x);
        settings.window_y = Some(pos.y);
    }
    if let Ok(size) = window.outer_size() {
        settings.window_width = Some(size.width);
        settings.window_height = Some(size.height);
    }
    settings.remember_window_state = true;
    write_desktop_settings(&state.db_path, &settings).map_err(stringify_error)?;
    Ok(settings)
}


#[tauri::command]
fn set_server_password(state: State<'_, AppState>, password: String) -> Result<ServerStatus, String> {
    let conn = open_conn(&state.db_path).map_err(stringify_error)?;
    set_setting(&conn, "server_password", password.trim()).map_err(stringify_error)?;
    drop(conn);
    server_status(&state).map_err(stringify_error)
}


#[tauri::command]
fn list_sync_inbox(state: State<'_, AppState>) -> Result<Vec<SyncInboxEntry>, String> {
    db_list_sync_inbox(&state.db_path).map_err(stringify_error)
}

#[tauri::command]
fn accept_sync_inbox(state: State<'_, AppState>, entry_id: String) -> Result<SyncInboxCommitResult, String> {
    let conn = open_conn(&state.db_path).map_err(stringify_error)?;
    let payload_json: String = conn.query_row(
        "SELECT payload_json FROM sync_inbox WHERE id = ?1 AND status = 'pending'",
        params![&entry_id],
        |row| row.get(0),
    ).map_err(stringify_error)?;
    let payload: SyncPushRequest = serde_json::from_str(&payload_json).map_err(stringify_error)?;
    let result = commit_sync_payload(&conn, &payload).map_err(stringify_error)?;
    conn.execute(
        "UPDATE sync_inbox SET status = 'accepted', applied_at = ?1 WHERE id = ?2",
        params![now_ms(), &entry_id],
    ).map_err(stringify_error)?;
    Ok(result)
}

#[tauri::command]
fn reject_sync_inbox(state: State<'_, AppState>, entry_id: String) -> Result<(), String> {
    let conn = open_conn(&state.db_path).map_err(stringify_error)?;
    conn.execute(
        "UPDATE sync_inbox SET status = 'rejected', applied_at = ?1 WHERE id = ?2 AND status = 'pending'",
        params![now_ms(), &entry_id],
    ).map_err(stringify_error)?;
    Ok(())
}

#[tauri::command]
fn update_sync_inbox_payload(state: State<'_, AppState>, entry_id: String, payload_json: String) -> Result<SyncInboxEntry, String> {
    let conn = open_conn(&state.db_path).map_err(stringify_error)?;
    let payload: SyncPushRequest = serde_json::from_str(&payload_json).map_err(stringify_error)?;
    let normalized_payload_json = serde_json::to_string_pretty(&payload).map_err(stringify_error)?;
    let summary = summarize_sync_payload(&payload);
    let summary_json = serde_json::to_string(&summary).map_err(stringify_error)?;
    let merge_candidates = find_merge_candidates(&conn, &payload).map_err(stringify_error)?;
    let merge_json = serde_json::to_string(&merge_candidates).map_err(stringify_error)?;
    conn.execute(
        r#"UPDATE sync_inbox
           SET payload_json = ?1, summary_json = ?2, merge_candidates_json = ?3
           WHERE id = ?4 AND status = 'pending'"#,
        params![normalized_payload_json, summary_json, merge_json, &entry_id],
    ).map_err(stringify_error)?;
    db_get_sync_inbox_entry(&conn, &entry_id).map_err(stringify_error)
}

#[tauri::command]
fn merge_catalog_item(state: State<'_, AppState>, kind: String, alias_id: String, canonical_id: String) -> Result<(), String> {
    let conn = open_conn(&state.db_path).map_err(stringify_error)?;
    merge_catalog_item_internal(&conn, &kind, &alias_id, &canonical_id, None).map_err(stringify_error)
}

#[tauri::command]
fn list_catalog_duplicate_suggestions(state: State<'_, AppState>) -> Result<Vec<CatalogDuplicateSuggestion>, String> {
    let conn = open_conn(&state.db_path).map_err(stringify_error)?;
    find_catalog_duplicate_suggestions(&conn).map_err(stringify_error)
}

#[tauri::command]
fn export_activities_csv(state: State<'_, AppState>) -> Result<String, String> {
    let activities = db_list_active_activities(&state.db_path).map_err(stringify_error)?;
    let mut writer = csv::Writer::from_writer(Vec::new());
    writer.write_record(["id", "code", "name", "description", "activity_type", "met", "kcal_per_min"]).map_err(stringify_error)?;
    for activity in activities {
        writer.write_record([activity.id, activity.code, activity.name, activity.description.unwrap_or_default(), activity.activity_type, activity.met.to_string(), activity.kcal_per_min.to_string()]).map_err(stringify_error)?;
    }
    let bytes = writer.into_inner().map_err(stringify_error)?;
    String::from_utf8(bytes).map_err(stringify_error)
}

#[tauri::command]
fn import_activities_csv(state: State<'_, AppState>, csv_text: String, skip_duplicates: Option<bool>) -> Result<ImportCommitResult, String> {
    let conn = open_conn(&state.db_path).map_err(stringify_error)?;
    let mut reader = csv::ReaderBuilder::new().trim(csv::Trim::All).flexible(true).from_reader(csv_text.as_bytes());
    let headers = reader.headers().map_err(stringify_error)?.clone();
    let mut inserted_or_updated = 0;
    let mut skipped = 0;
    let mut errors = vec![];
    for (index, result) in reader.records().enumerate() {
        let row_number = index + 2;
        let record = match result { Ok(record) => record, Err(err) => { errors.push(format!("Row {row_number}: {err}")); skipped += 1; continue; } };
        let mut row_errors = vec![];
        let name = get_csv(&headers, &record, "name").unwrap_or_default();
        if name.trim().is_empty() { row_errors.push("name is required".into()); }
        let met = parse_number_default(&headers, &record, "met", 0.0, &mut row_errors);
        let kcal_per_min = parse_number_default(&headers, &record, "kcal_per_min", 0.0, &mut row_errors);
        if !row_errors.is_empty() { errors.push(format!("Row {row_number}: {}", row_errors.join(", "))); skipped += 1; continue; }
        let activity = ActivityDefinition {
            id: get_csv(&headers, &record, "id").filter(|v| !v.trim().is_empty()).unwrap_or_else(|| format!("activity-{}", Uuid::new_v4())),
            code: get_csv(&headers, &record, "code").filter(|v| !v.trim().is_empty()).unwrap_or_else(|| "custom".into()),
            name,
            description: get_csv(&headers, &record, "description").filter(|v| !v.trim().is_empty()),
            activity_type: get_csv(&headers, &record, "activity_type").filter(|v| !v.trim().is_empty()).unwrap_or_else(|| "custom".into()),
            met,
            kcal_per_min,
            updated_at: now_ms(),
            deleted_at: None,
        };
        if skip_duplicates.unwrap_or(false) && find_existing_activity_duplicate(&conn, &activity).map_err(stringify_error)?.is_some() { skipped += 1; continue; }
        if let Err(err) = upsert_activity(&conn, &activity) { errors.push(format!("Row {row_number}: {err}")); skipped += 1; } else { inserted_or_updated += 1; }
    }
    Ok(ImportCommitResult { inserted_or_updated, skipped, errors })
}

#[tauri::command]
fn export_recipes_csv(state: State<'_, AppState>) -> Result<String, String> {
    let recipes = db_list_recipe_details(&state.db_path).map_err(stringify_error)?;
    let mut writer = csv::Writer::from_writer(Vec::new());
    writer.write_record(["recipe_id", "name", "description", "note", "total_weight_g", "servings_count", "ingredients_json"]).map_err(stringify_error)?;
    for detail in recipes {
        let ingredients: Vec<RecipeInputItem> = detail.items
            .iter()
            .map(|item| RecipeInputItem { food_id: item.food_id.clone(), amount_g: item.amount_g })
            .collect();
        let ingredients_json = serde_json::to_string(&ingredients).map_err(stringify_error)?;
        writer.write_record([
            detail.recipe.id.clone(),
            detail.recipe.name.clone(),
            detail.recipe.description.clone().unwrap_or_default(),
            detail.recipe.note.clone().unwrap_or_default(),
            detail.recipe.total_weight_g.map(|v| v.to_string()).unwrap_or_default(),
            detail.recipe.servings_count.map(|v| v.to_string()).unwrap_or_default(),
            ingredients_json,
        ]).map_err(stringify_error)?;
    }
    let bytes = writer.into_inner().map_err(stringify_error)?;
    String::from_utf8(bytes).map_err(stringify_error)
}

#[tauri::command]
fn import_recipes_csv(state: State<'_, AppState>, csv_text: String, skip_duplicates: Option<bool>) -> Result<ImportCommitResult, String> {
    use std::collections::BTreeMap;
    #[derive(Default)]
    struct Group { id: String, name: String, description: Option<String>, note: Option<String>, total_weight_g: Option<f64>, servings_count: Option<f64>, items: Vec<RecipeInputItem> }

    let conn = open_conn(&state.db_path).map_err(stringify_error)?;
    let source_id = setting(&conn, "source_id").map_err(stringify_error)?;
    let mut reader = csv::ReaderBuilder::new().trim(csv::Trim::All).flexible(true).from_reader(csv_text.as_bytes());
    let headers = reader.headers().map_err(stringify_error)?.clone();
    let mut groups: BTreeMap<String, Group> = BTreeMap::new();
    let mut skipped = 0;
    let mut errors = vec![];

    for (index, result) in reader.records().enumerate() {
        let row_number = index + 2;
        let record = match result { Ok(record) => record, Err(err) => { errors.push(format!("Row {row_number}: {err}")); skipped += 1; continue; } };
        let mut row_errors = vec![];
        let name = get_csv(&headers, &record, "name").unwrap_or_default();
        if name.trim().is_empty() { row_errors.push("name is required".into()); }
        let total_weight_g = parse_optional_number(&headers, &record, "total_weight_g", &mut row_errors);
        let servings_count = parse_optional_number(&headers, &record, "servings_count", &mut row_errors);
        let recipe_id = get_csv(&headers, &record, "recipe_id").filter(|v| !v.trim().is_empty()).unwrap_or_else(|| format!("recipe-import-{}", name.to_lowercase().replace(' ', "-")));
        let mut items: Vec<RecipeInputItem> = vec![];

        if let Some(ingredients_json) = get_csv(&headers, &record, "ingredients_json").filter(|v| !v.trim().is_empty()) {
            match serde_json::from_str::<Vec<RecipeInputItem>>(&ingredients_json) {
                Ok(parsed) => items.extend(parsed.into_iter().filter(|item| !item.food_id.trim().is_empty() && item.amount_g > 0.0)),
                Err(err) => row_errors.push(format!("ingredients_json is invalid: {err}")),
            }
        } else {
            let food_id = get_csv(&headers, &record, "food_id").unwrap_or_default();
            if food_id.trim().is_empty() { row_errors.push("food_id is required".into()); }
            let amount_g = parse_required_number(&headers, &record, "amount_g", &mut row_errors);
            if !food_id.trim().is_empty() && amount_g > 0.0 { items.push(RecipeInputItem { food_id, amount_g }); }
        }

        if items.is_empty() { row_errors.push("at least one ingredient is required".into()); }
        if !row_errors.is_empty() { errors.push(format!("Row {row_number}: {}", row_errors.join(", "))); skipped += 1; continue; }

        let key = recipe_id.clone();
        let group = groups.entry(key).or_insert_with(|| Group {
            id: recipe_id,
            name: name.clone(),
            description: get_csv(&headers, &record, "description").filter(|v| !v.trim().is_empty()),
            note: get_csv(&headers, &record, "note").filter(|v| !v.trim().is_empty()),
            total_weight_g,
            servings_count,
            items: vec![],
        });
        group.items.extend(items);
    }

    let mut inserted_or_updated = 0;
    for (_, group) in groups {
        if group.items.is_empty() { skipped += 1; continue; }
        let now = now_ms();
        let ingredient_weight: f64 = group.items.iter().map(|i| i.amount_g).sum();
        let total_weight: f64 = group.total_weight_g.filter(|value| value.is_finite() && *value > 0.0).unwrap_or(ingredient_weight);
        if skip_duplicates.unwrap_or(false) {
            let incoming = Recipe { id: group.id.clone(), source_id: source_id.clone(), name: group.name.clone(), description: group.description.clone(), note: group.note.clone(), total_weight_g: Some(total_weight), servings_count: group.servings_count, updated_at: now, deleted_at: None };
            if find_existing_recipe_duplicate(&conn, &incoming).map_err(stringify_error)?.is_some() { skipped += 1; continue; }
        }
        let tx = match conn.unchecked_transaction() { Ok(tx) => tx, Err(err) => { errors.push(err.to_string()); skipped += 1; continue; } };
        let result: Result<()> = (|| {
            tx.execute(
                r#"INSERT INTO recipes (id, source_id, name, description, note, total_weight_g, servings_count, updated_at, deleted_at)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, NULL)
                ON CONFLICT(id) DO UPDATE SET source_id = excluded.source_id, name = excluded.name, description = excluded.description, note = excluded.note, total_weight_g = excluded.total_weight_g, servings_count = excluded.servings_count, updated_at = excluded.updated_at, deleted_at = NULL"#,
                params![group.id, source_id, group.name, group.description, group.note, total_weight, group.servings_count, now],
            )?;
            tx.execute("UPDATE recipe_items SET deleted_at = ?1, updated_at = ?1 WHERE recipe_id = ?2 AND deleted_at IS NULL", params![now, group.id])?;
            for item in group.items {
                tx.execute("INSERT INTO recipe_items (id, recipe_id, food_id, amount_g, updated_at, deleted_at) VALUES (?1, ?2, ?3, ?4, ?5, NULL)", params![format!("recipe-item-{}", Uuid::new_v4()), group.id, item.food_id, item.amount_g, now])?;
            }
            Ok(())
        })();
        if let Err(err) = result { errors.push(format!("{}: {err}", group.name)); skipped += 1; }
        else if let Err(err) = tx.commit() { errors.push(format!("{}: {err}", group.name)); skipped += 1; }
        else { inserted_or_updated += 1; }
    }
    Ok(ImportCommitResult { inserted_or_updated, skipped, errors })
}



fn query_active_foods(conn: &Connection) -> Result<Vec<Food>> {
    let mut stmt = conn.prepare(
        r#"SELECT id, source_id, name, brand, catalog_kind, note, barcode, default_unit, serving_size_g,
                 kcal_per_100g, carbs_per_100g, fat_per_100g, protein_per_100g,
                 sugars_per_100g, fiber_per_100g, salt_per_100g, updated_at, deleted_at
           FROM foods WHERE deleted_at IS NULL ORDER BY name COLLATE NOCASE"#,
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(Food {
            id: row.get(0)?, source_id: row.get(1)?, name: row.get(2)?, brand: row.get(3)?, catalog_kind: row.get(4)?, note: row.get(5)?, barcode: row.get(6)?, default_unit: row.get(7)?, serving_size_g: row.get(8)?,
            kcal_per_100g: row.get(9)?, carbs_per_100g: row.get(10)?, fat_per_100g: row.get(11)?, protein_per_100g: row.get(12)?, sugars_per_100g: row.get(13)?, fiber_per_100g: row.get(14)?, salt_per_100g: row.get(15)?, updated_at: row.get(16)?, deleted_at: row.get(17)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

fn query_active_recipes(conn: &Connection) -> Result<Vec<Recipe>> {
    let mut stmt = conn.prepare(
        r#"SELECT id, source_id, name, description, note, total_weight_g, servings_count, updated_at, deleted_at
           FROM recipes WHERE deleted_at IS NULL ORDER BY name COLLATE NOCASE"#,
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(Recipe { id: row.get(0)?, source_id: row.get(1)?, name: row.get(2)?, description: row.get(3)?, note: row.get(4)?, total_weight_g: row.get(5)?, servings_count: row.get(6)?, updated_at: row.get(7)?, deleted_at: row.get(8)? })
    })?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

fn query_active_activities(conn: &Connection) -> Result<Vec<ActivityDefinition>> {
    let mut stmt = conn.prepare(
        r#"SELECT id, code, name, description, activity_type, met, kcal_per_min, updated_at, deleted_at
           FROM activities WHERE deleted_at IS NULL ORDER BY name COLLATE NOCASE"#,
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(ActivityDefinition { id: row.get(0)?, code: row.get(1)?, name: row.get(2)?, description: row.get(3)?, activity_type: row.get(4)?, met: row.get(5)?, kcal_per_min: row.get(6)?, updated_at: row.get(7)?, deleted_at: row.get(8)? })
    })?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

fn summarize_sync_payload(payload: &SyncPushRequest) -> SyncInboxSummary {
    SyncInboxSummary {
        foods: payload.foods.as_ref().map(|v| v.len()).unwrap_or(0),
        recipes: payload.recipes.as_ref().map(|v| v.len()).unwrap_or(0),
        recipe_items: payload.recipe_items.as_ref().map(|v| v.len()).unwrap_or(0),
        activities: payload.activities.as_ref().map(|v| v.len()).unwrap_or(0),
        intakes: payload.intakes.len(),
        weight_logs: payload.weight_logs.len(),
        activity_logs: payload.activity_logs.len(),
    }
}

fn normalize_text(value: &str) -> String {
    value.trim().to_lowercase().split_whitespace().collect::<Vec<_>>().join(" ")
}

fn number_key(value: f64) -> i64 {
    (value * 1000.0).round() as i64
}

fn optional_number_key(value: Option<f64>) -> i64 {
    number_key(value.unwrap_or(0.0))
}

fn food_signature(food: &Food) -> String {
    format!(
        "{}|{}|{}|{}|{}|{}|{}|{}|{}|{}|{}|{}|{}|{}",
        normalize_text(&food.name),
        normalize_text(food.brand.as_deref().unwrap_or("")),
        normalize_text(&food.catalog_kind),
        normalize_text(food.note.as_deref().unwrap_or("")),
        normalize_text(food.barcode.as_deref().unwrap_or("")),
        normalize_text(&food.default_unit),
        optional_number_key(food.serving_size_g),
        number_key(food.kcal_per_100g),
        number_key(food.carbs_per_100g),
        number_key(food.fat_per_100g),
        number_key(food.protein_per_100g),
        number_key(food.sugars_per_100g),
        number_key(food.fiber_per_100g),
        number_key(food.salt_per_100g),
    )
}

fn recipe_signature(recipe: &Recipe) -> String {
    format!(
        "{}|{}|{}|{}|{}",
        normalize_text(&recipe.name),
        normalize_text(recipe.description.as_deref().unwrap_or("")),
        normalize_text(recipe.note.as_deref().unwrap_or("")),
        optional_number_key(recipe.total_weight_g),
        optional_number_key(recipe.servings_count),
    )
}

fn activity_signature(activity: &ActivityDefinition) -> String {
    format!(
        "{}|{}|{}|{}|{}|{}",
        normalize_text(&activity.code),
        normalize_text(&activity.name),
        normalize_text(activity.description.as_deref().unwrap_or("")),
        normalize_text(&activity.activity_type),
        number_key(activity.met),
        number_key(activity.kcal_per_min),
    )
}

fn find_existing_food_duplicate(conn: &Connection, incoming: &Food) -> Result<Option<Food>> {
    let existing = query_active_foods(conn)?;
    Ok(existing.into_iter().find(|item| item.id != incoming.id && food_signature(item) == food_signature(incoming)))
}

fn find_existing_recipe_duplicate(conn: &Connection, incoming: &Recipe) -> Result<Option<Recipe>> {
    let existing = query_active_recipes(conn)?;
    Ok(existing.into_iter().find(|item| item.id != incoming.id && recipe_signature(item) == recipe_signature(incoming)))
}

fn find_existing_activity_duplicate(conn: &Connection, incoming: &ActivityDefinition) -> Result<Option<ActivityDefinition>> {
    let existing = query_active_activities(conn)?;
    Ok(existing.into_iter().find(|item| item.id != incoming.id && activity_signature(item) == activity_signature(incoming)))
}

fn find_merge_candidates(conn: &Connection, payload: &SyncPushRequest) -> Result<Vec<MergeCandidate>> {
    let mut candidates = Vec::new();
    if let Some(foods) = &payload.foods {
        for food in foods {
            if let Some(existing) = find_existing_food_duplicate(conn, food)? {
                candidates.push(MergeCandidate { kind: "food".into(), incoming_id: food.id.clone(), incoming_name: food.name.clone(), canonical_id: existing.id, canonical_name: existing.name });
            }
        }
    }
    if let Some(recipes) = &payload.recipes {
        for recipe in recipes {
            if let Some(existing) = find_existing_recipe_duplicate(conn, recipe)? {
                candidates.push(MergeCandidate { kind: "recipe".into(), incoming_id: recipe.id.clone(), incoming_name: recipe.name.clone(), canonical_id: existing.id, canonical_name: existing.name });
            }
        }
    }
    if let Some(activities) = &payload.activities {
        for activity in activities {
            if let Some(existing) = find_existing_activity_duplicate(conn, activity)? {
                candidates.push(MergeCandidate { kind: "activity".into(), incoming_id: activity.id.clone(), incoming_name: activity.name.clone(), canonical_id: existing.id, canonical_name: existing.name });
            }
        }
    }
    Ok(candidates)
}

fn loose_name_key(value: &str) -> String {
    value
        .trim()
        .to_lowercase()
        .chars()
        .map(|ch| if ch.is_alphanumeric() { ch } else { ' ' })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn duplicate_ids_key(kind: &str, item_ids: &[String]) -> String {
    let mut ids = item_ids.to_vec();
    ids.sort();
    format!("{}:{}", kind, ids.join("|"))
}

fn push_duplicate_group(
    suggestions: &mut Vec<CatalogDuplicateSuggestion>,
    seen: &mut HashSet<String>,
    kind: &str,
    reason: &str,
    confidence: &str,
    score: u8,
    key: String,
    mut items: Vec<CatalogDuplicateItem>,
) {
    if items.len() < 2 {
        return;
    }
    items.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()).then_with(|| b.updated_at.cmp(&a.updated_at)));
    let ids = items.iter().map(|item| item.id.clone()).collect::<Vec<_>>();
    let seen_key = duplicate_ids_key(kind, &ids);
    if seen.contains(&seen_key) {
        return;
    }
    seen.insert(seen_key);
    suggestions.push(CatalogDuplicateSuggestion {
        kind: kind.to_string(),
        reason: reason.to_string(),
        confidence: confidence.to_string(),
        score,
        key,
        items,
    });
}

fn find_catalog_duplicate_suggestions(conn: &Connection) -> Result<Vec<CatalogDuplicateSuggestion>> {
    let foods = query_active_foods(conn)?;
    let recipes = query_active_recipes(conn)?;
    let activities = query_active_activities(conn)?;
    let mut suggestions = Vec::new();
    let mut seen = HashSet::new();

    let mut food_exact: HashMap<String, Vec<CatalogDuplicateItem>> = HashMap::new();
    let mut food_name: HashMap<String, Vec<CatalogDuplicateItem>> = HashMap::new();
    for food in foods {
        let item = CatalogDuplicateItem {
            id: food.id.clone(),
            name: food.name.clone(),
            subtitle: format!(
                "{} kcal / 100g · {} · {}",
                (food.kcal_per_100g * 10.0).round() / 10.0,
                food.brand.clone().filter(|v| !v.trim().is_empty()).unwrap_or_else(|| "no brand".into()),
                food.default_unit
            ),
            updated_at: food.updated_at,
        };
        food_exact.entry(food_signature(&food)).or_default().push(item.clone());
        let name_key = loose_name_key(&food.name);
        if !name_key.is_empty() {
            food_name.entry(name_key).or_default().push(item);
        }
    }
    for (key, items) in food_exact {
        push_duplicate_group(&mut suggestions, &mut seen, "food", "Exact same food data", "high", 100, key, items);
    }
    for (key, items) in food_name {
        push_duplicate_group(&mut suggestions, &mut seen, "food", "Same normalized food name", "medium", 75, key, items);
    }

    let mut recipe_name: HashMap<String, Vec<CatalogDuplicateItem>> = HashMap::new();
    let mut recipe_meta: HashMap<String, Vec<CatalogDuplicateItem>> = HashMap::new();
    for recipe in recipes {
        let item = CatalogDuplicateItem {
            id: recipe.id.clone(),
            name: recipe.name.clone(),
            subtitle: format!(
                "{} servings · {}g total",
                recipe.servings_count.unwrap_or(0.0),
                recipe.total_weight_g.unwrap_or(0.0)
            ),
            updated_at: recipe.updated_at,
        };
        recipe_meta.entry(recipe_signature(&recipe)).or_default().push(item.clone());
        let name_key = loose_name_key(&recipe.name);
        if !name_key.is_empty() {
            recipe_name.entry(name_key).or_default().push(item);
        }
    }
    for (key, items) in recipe_meta {
        push_duplicate_group(&mut suggestions, &mut seen, "recipe", "Exact same recipe metadata", "high", 92, key, items);
    }
    for (key, items) in recipe_name {
        push_duplicate_group(&mut suggestions, &mut seen, "recipe", "Same normalized recipe name", "medium", 72, key, items);
    }

    let mut activity_exact: HashMap<String, Vec<CatalogDuplicateItem>> = HashMap::new();
    let mut activity_name: HashMap<String, Vec<CatalogDuplicateItem>> = HashMap::new();
    let mut activity_code: HashMap<String, Vec<CatalogDuplicateItem>> = HashMap::new();
    for activity in activities {
        let item = CatalogDuplicateItem {
            id: activity.id.clone(),
            name: activity.name.clone(),
            subtitle: format!(
                "code {} · MET {} · {} kcal/min · {}",
                activity.code,
                (activity.met * 10.0).round() / 10.0,
                (activity.kcal_per_min * 10.0).round() / 10.0,
                activity.activity_type
            ),
            updated_at: activity.updated_at,
        };
        activity_exact.entry(activity_signature(&activity)).or_default().push(item.clone());
        let name_key = loose_name_key(&activity.name);
        if !name_key.is_empty() {
            activity_name.entry(name_key).or_default().push(item.clone());
        }
        let code_key = loose_name_key(&activity.code);
        if !code_key.is_empty() && code_key != "custom" {
            activity_code.entry(code_key).or_default().push(item);
        }
    }
    for (key, items) in activity_exact {
        push_duplicate_group(&mut suggestions, &mut seen, "activity", "Exact same activity data", "high", 100, key, items);
    }
    for (key, items) in activity_name {
        push_duplicate_group(&mut suggestions, &mut seen, "activity", "Same normalized activity name", "medium", 78, key, items);
    }
    for (key, items) in activity_code {
        push_duplicate_group(&mut suggestions, &mut seen, "activity", "Same activity code", "medium", 70, key, items);
    }

    suggestions.sort_by(|a, b| b.score.cmp(&a.score).then_with(|| a.kind.cmp(&b.kind)).then_with(|| a.key.cmp(&b.key)));
    Ok(suggestions)
}

fn insert_alias(conn: &Connection, kind: &str, alias_id: &str, canonical_id: &str, source_id: Option<&str>, now: i64) -> Result<()> {
    if alias_id.trim().is_empty() || canonical_id.trim().is_empty() || alias_id == canonical_id {
        return Ok(());
    }
    conn.execute(
        r#"INSERT INTO item_aliases (kind, alias_id, canonical_id, source_id, updated_at)
        VALUES (?1, ?2, ?3, ?4, ?5)
        ON CONFLICT(kind, alias_id) DO UPDATE SET canonical_id = excluded.canonical_id, source_id = excluded.source_id, updated_at = excluded.updated_at"#,
        params![kind, alias_id, canonical_id, source_id, now],
    )?;
    Ok(())
}

fn merge_catalog_item_internal(conn: &Connection, kind: &str, alias_id: &str, canonical_id: &str, source_id: Option<&str>) -> Result<()> {
    let kind = kind.trim();
    let alias_id = alias_id.trim().trim_start_matches("recipe:");
    let canonical_id = canonical_id.trim().trim_start_matches("recipe:");
    if alias_id.is_empty() || canonical_id.is_empty() || alias_id == canonical_id {
        return Ok(());
    }

    let now = now_ms();
    insert_alias(conn, kind, alias_id, canonical_id, source_id, now)?;

    match kind {
        "food" => {
            conn.execute(
                "UPDATE intakes SET food_id = ?1, updated_at = ?3 WHERE item_type = 'food' AND food_id = ?2",
                params![canonical_id, alias_id, now],
            )?;
            conn.execute(
                "UPDATE recipe_items SET food_id = ?1, updated_at = ?3 WHERE food_id = ?2",
                params![canonical_id, alias_id, now],
            )?;
            conn.execute(
                "UPDATE foods SET deleted_at = ?1, updated_at = ?1 WHERE id = ?2",
                params![now, alias_id],
            )?;
            conn.execute("UPDATE foods SET updated_at = ?1 WHERE id = ?2", params![now, canonical_id])?;
        }
        "recipe" => {
            let alias_recipe_ref = format!("recipe:{}", alias_id);
            let canonical_recipe_ref = format!("recipe:{}", canonical_id);
            conn.execute(
                "UPDATE intakes SET food_id = ?1, updated_at = ?4 WHERE item_type = 'recipe' AND (food_id = ?2 OR food_id = ?3)",
                params![canonical_recipe_ref, alias_id, alias_recipe_ref, now],
            )?;
            conn.execute(
                "UPDATE recipe_items SET food_id = ?1, updated_at = ?4 WHERE food_id = ?2 OR food_id = ?3",
                params![canonical_recipe_ref, alias_id, alias_recipe_ref, now],
            )?;
            conn.execute(
                "UPDATE recipe_items SET deleted_at = ?1, updated_at = ?1 WHERE recipe_id = ?2 AND deleted_at IS NULL",
                params![now, alias_id],
            )?;
            conn.execute(
                "UPDATE recipes SET deleted_at = ?1, updated_at = ?1 WHERE id = ?2",
                params![now, alias_id],
            )?;
            conn.execute("UPDATE recipes SET updated_at = ?1 WHERE id = ?2", params![now, canonical_id])?;
        }
        "activity" => {
            conn.execute(
                "UPDATE activity_logs SET activity_id = ?1, updated_at = ?3 WHERE activity_id = ?2",
                params![canonical_id, alias_id, now],
            )?;
            conn.execute(
                "UPDATE activities SET deleted_at = ?1, updated_at = ?1 WHERE id = ?2",
                params![now, alias_id],
            )?;
            conn.execute("UPDATE activities SET updated_at = ?1 WHERE id = ?2", params![now, canonical_id])?;
        }
        _ => return Err(anyhow!("unsupported catalog kind: {}", kind)),
    }

    Ok(())
}

fn resolve_alias(conn: &Connection, kind: &str, id: &str) -> Result<String> {
    let mut current = id.to_string();
    for _ in 0..16 {
        let next: Option<String> = conn.query_row(
            "SELECT canonical_id FROM item_aliases WHERE kind = ?1 AND alias_id = ?2",
            params![kind, current],
            |row| row.get(0),
        ).optional()?;
        match next {
            Some(value) if !value.is_empty() && value != current => current = value,
            _ => break,
        }
    }
    Ok(current)
}

fn canonical_food_ref(conn: &Connection, id: &str) -> Result<String> {
    resolve_alias(conn, "food", id)
}

fn canonical_recipe_ref(conn: &Connection, id: &str) -> Result<String> {
    resolve_alias(conn, "recipe", id.trim_start_matches("recipe:"))
}

fn canonical_activity_ref(conn: &Connection, id: Option<String>) -> Result<Option<String>> {
    match id {
        Some(value) if !value.trim().is_empty() => Ok(Some(resolve_alias(conn, "activity", &value)?)),
        _ => Ok(None),
    }
}

fn commit_sync_payload(conn: &Connection, payload: &SyncPushRequest) -> Result<SyncInboxCommitResult> {
    let now = now_ms();
    let source_id = payload.source_id.as_deref();
    let mut merged = 0_usize;
    let mut inserted_or_updated = 0_usize;

    if let Some(foods) = &payload.foods {
        for food in foods {
            if let Some(existing) = find_existing_food_duplicate(conn, food)? {
                merge_catalog_item_internal(conn, "food", &food.id, &existing.id, source_id)?;
                merged += 1;
            } else {
                let mut next = food.clone();
                next.updated_at = if next.updated_at > 0 { next.updated_at } else { now };
                upsert_food(conn, &next)?;
                inserted_or_updated += 1;
            }
        }
    }

    if let Some(activities) = &payload.activities {
        for activity in activities {
            if let Some(existing) = find_existing_activity_duplicate(conn, activity)? {
                merge_catalog_item_internal(conn, "activity", &activity.id, &existing.id, source_id)?;
                merged += 1;
            } else {
                let mut next = activity.clone();
                next.updated_at = if next.updated_at > 0 { next.updated_at } else { now };
                upsert_activity(conn, &next)?;
                inserted_or_updated += 1;
            }
        }
    }

    if let Some(recipes) = &payload.recipes {
        for recipe in recipes {
            if let Some(existing) = find_existing_recipe_duplicate(conn, recipe)? {
                merge_catalog_item_internal(conn, "recipe", &recipe.id, &existing.id, source_id)?;
                merged += 1;
            } else {
                conn.execute(
                    r#"INSERT INTO recipes (id, source_id, name, description, note, total_weight_g, servings_count, updated_at, deleted_at)
                    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
                    ON CONFLICT(id) DO UPDATE SET source_id = excluded.source_id, name = excluded.name, description = excluded.description, note = excluded.note, total_weight_g = excluded.total_weight_g, servings_count = excluded.servings_count, updated_at = excluded.updated_at, deleted_at = excluded.deleted_at"#,
                    params![&recipe.id, &recipe.source_id, &recipe.name, &recipe.description, &recipe.note, &recipe.total_weight_g, &recipe.servings_count, if recipe.updated_at > 0 { recipe.updated_at } else { now }, &recipe.deleted_at],
                )?;
                inserted_or_updated += 1;
            }
        }
    }

    if let Some(recipe_items) = &payload.recipe_items {
        for item in recipe_items {
            let raw_recipe_id = item.recipe_id.trim_start_matches("recipe:");
            let recipe_id = canonical_recipe_ref(conn, &item.recipe_id)?;
            if recipe_id != raw_recipe_id {
                continue;
            }
            let food_id = if item.food_id.starts_with("recipe:") {
                format!("recipe:{}", canonical_recipe_ref(conn, &item.food_id)?)
            } else {
                canonical_food_ref(conn, &item.food_id)?
            };
            conn.execute(
                r#"INSERT INTO recipe_items (id, recipe_id, food_id, amount_g, updated_at, deleted_at)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6)
                ON CONFLICT(id) DO UPDATE SET recipe_id = excluded.recipe_id, food_id = excluded.food_id, amount_g = excluded.amount_g, updated_at = excluded.updated_at, deleted_at = excluded.deleted_at"#,
                params![&item.id, recipe_id, food_id, item.amount_g, if item.updated_at > 0 { item.updated_at } else { now }, &item.deleted_at],
            )?;
            inserted_or_updated += 1;
        }
    }

    for intake in &payload.intakes {
        let item_type = intake.item_type.clone().unwrap_or_else(|| "food".into());
        let food_id = match item_type.as_str() {
            "recipe" => format!("recipe:{}", canonical_recipe_ref(conn, &intake.food_id)?),
            "note" => intake.food_id.clone(),
            _ => canonical_food_ref(conn, &intake.food_id)?,
        };
        conn.execute(
            r#"
            INSERT INTO intakes (id, source_id, item_type, food_id, consumed_at, meal_type, amount_g, food_snapshot_json, note_title, note_description, synced_at, created_at, updated_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11, ?11)
            ON CONFLICT(id) DO UPDATE SET
                source_id = excluded.source_id,
                item_type = excluded.item_type,
                food_id = excluded.food_id,
                consumed_at = excluded.consumed_at,
                meal_type = excluded.meal_type,
                amount_g = excluded.amount_g,
                food_snapshot_json = excluded.food_snapshot_json,
                note_title = excluded.note_title,
                note_description = excluded.note_description,
                synced_at = excluded.synced_at,
                updated_at = excluded.updated_at
            "#,
            params![&intake.id, &intake.source_id, item_type, food_id, intake.consumed_at, &intake.meal_type, intake.amount_g, &intake.food_snapshot_json, &intake.note_title, &intake.note_description, now],
        )?;
    }

    for weight in &payload.weight_logs {
        conn.execute(
            r#"
            INSERT INTO weight_logs (id, measured_at, weight_kg, bmi, source, synced_at, created_at, updated_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6, ?6)
            ON CONFLICT(id) DO UPDATE SET measured_at = excluded.measured_at, weight_kg = excluded.weight_kg, bmi = excluded.bmi, source = excluded.source, synced_at = excluded.synced_at, updated_at = excluded.updated_at
            "#,
            params![&weight.id, weight.measured_at, weight.weight_kg, weight.bmi.unwrap_or(0.0), &weight.source, now],
        )?;
    }

    for activity in &payload.activity_logs {
        let activity_id = canonical_activity_ref(conn, activity.activity_id.clone())?;
        conn.execute(
            r#"
            INSERT INTO activity_logs (id, activity_id, activity_name, performed_at, duration_min, kcal, source, synced_at, created_at, updated_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8, ?8)
            ON CONFLICT(id) DO UPDATE SET activity_id = excluded.activity_id, activity_name = excluded.activity_name, performed_at = excluded.performed_at, duration_min = excluded.duration_min, kcal = excluded.kcal, source = excluded.source, synced_at = excluded.synced_at, updated_at = excluded.updated_at
            "#,
            params![&activity.id, activity_id, &activity.activity_name, activity.performed_at, activity.duration_min, activity.kcal, &activity.source, now],
        )?;
    }

    Ok(SyncInboxCommitResult {
        accepted: true,
        merged,
        inserted_or_updated,
        intakes: payload.intakes.len(),
        weight_logs: payload.weight_logs.len(),
        activity_logs: payload.activity_logs.len(),
    })
}

fn server_status(state: &AppState) -> Result<ServerStatus> {
    let conn = open_conn(&state.db_path)?;
    let token = setting(&conn, "server_password")?;
    let source_id = setting(&conn, "source_id")?;
    let auth_required = auth_required_for_token(&token);
    let password_set = !token.trim().is_empty();
    let runtime = state.server.lock().map_err(|_| anyhow!("server lock poisoned"))?;
    let port = runtime.as_ref().map(|server| server.port);
    Ok(ServerStatus {
        running: runtime.is_some(),
        bind_address: port.map(|p| format!("0.0.0.0:{p}")),
        port,
        base_url: port.map(|p| format!("http://<desktop-lan-ip>:{p}/api/v1")),
        password_set,
        token,
        app_channel: app_channel(),
        source_id,
        auth_required,
        dev_mode: dev_mode(),
        catalog_revision: db_catalog_revision(&state.db_path).unwrap_or(0),
    })
}

fn app_channel() -> String {
    match std::env::var("NUTRINO_APP_CHANNEL").unwrap_or_default().to_lowercase().as_str() {
        "dev" => "dev".into(),
        "stable" => "stable".into(),
        _ if cfg!(debug_assertions) => "dev".into(),
        _ => "stable".into(),
    }
}

fn dev_mode() -> bool {
    app_channel() == "dev"
}

fn auth_required_for_token(token: &str) -> bool {
    !token.trim().is_empty()
}

async fn health(AxumState(state): AxumState<ApiState>) -> impl IntoResponse {
    Json(HealthResponse {
        ok: true,
        name: APP_NAME.to_string(),
        app: APP_NAME.to_string(),
        source_id: state.source_id.clone(),
        version: APP_VERSION.to_string(),
        auth_required: state.auth_required,
        app_channel: if state.dev_mode { "dev".into() } else { "stable".into() },
        dev_mode: state.dev_mode,
        catalog_revision: db_catalog_revision(&state.db_path).unwrap_or(0),
    })
}

async fn sync_pull(
    AxumState(state): AxumState<ApiState>,
    headers: HeaderMap,
    Query(query): Query<SyncPullQuery>,
) -> Result<Json<SyncPullResponse>, StatusCode> {
    authorize(&headers, &state.token, state.auth_required)?;
    let since = query.since.unwrap_or(0);
    let foods = db_list_foods_for_sync(&state.db_path, since).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let recipes = db_list_recipes_for_sync(&state.db_path, since).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let recipe_items = db_list_recipe_items(&state.db_path, since).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let activities = db_list_activities_for_sync(&state.db_path, since).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let aliases = db_list_aliases_for_sync(&state.db_path, since).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(SyncPullResponse {
        server_time: now_ms(),
        source_id: state.source_id.clone(),
        foods,
        recipes,
        recipe_items,
        activities,
        aliases,
    }))
}

async fn sync_push(
    AxumState(state): AxumState<ApiState>,
    headers: HeaderMap,
    Json(payload): Json<SyncPushRequest>,
) -> Result<Json<SyncPushResponse>, StatusCode> {
    authorize(&headers, &state.token, state.auth_required)?;
    let conn = open_conn(&state.db_path).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let now = now_ms();
    let source_id = payload.source_id.clone().unwrap_or_else(|| state.source_id.clone());
    let inbox_id = format!("sync-inbox-{}", Uuid::new_v4());
    let summary = summarize_sync_payload(&payload);
    let merge_candidates = find_merge_candidates(&conn, &payload).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let payload_json = serde_json::to_string(&payload).map_err(|_| StatusCode::BAD_REQUEST)?;
    let summary_json = serde_json::to_string(&summary).map_err(|_| StatusCode::BAD_REQUEST)?;
    let merge_json = serde_json::to_string(&merge_candidates).map_err(|_| StatusCode::BAD_REQUEST)?;
    conn.execute(
        r#"INSERT INTO sync_inbox (id, source_id, device_name, received_at, payload_json, summary_json, merge_candidates_json, status, applied_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'pending', NULL)"#,
        params![inbox_id, source_id, payload.device_name, now, payload_json, summary_json, merge_json],
    ).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(SyncPushResponse {
        accepted: true,
        server_time: now,
    }))
}
async fn api_list_foods(
    AxumState(state): AxumState<ApiState>,
    headers: HeaderMap,
) -> Result<Json<Vec<Food>>, StatusCode> {
    authorize(&headers, &state.token, state.auth_required)?;
    db_list_active_foods(&state.db_path)
        .map(Json)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}

async fn api_create_food(
    AxumState(state): AxumState<ApiState>,
    headers: HeaderMap,
    Json(mut food): Json<Food>,
) -> Result<Json<Food>, StatusCode> {
    authorize(&headers, &state.token, state.auth_required)?;
    food.updated_at = now_ms();
    food.deleted_at = None;
    let conn = open_conn(&state.db_path).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    upsert_food(&conn, &food).map_err(|_| StatusCode::BAD_REQUEST)?;
    Ok(Json(food))
}

async fn api_list_recipes(
    AxumState(state): AxumState<ApiState>,
    headers: HeaderMap,
) -> Result<Json<Vec<Recipe>>, StatusCode> {
    authorize(&headers, &state.token, state.auth_required)?;
    db_list_active_recipes(&state.db_path)
        .map(Json)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}

async fn api_list_activities(
    AxumState(state): AxumState<ApiState>,
    headers: HeaderMap,
) -> Result<Json<Vec<ActivityDefinition>>, StatusCode> {
    authorize(&headers, &state.token, state.auth_required)?;
    db_list_active_activities(&state.db_path)
        .map(Json)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}

fn authorize(headers: &HeaderMap, token: &str, required: bool) -> Result<(), StatusCode> {
    if !required {
        return Ok(());
    }

    let Some(value) = headers.get("authorization") else {
        return Err(StatusCode::UNAUTHORIZED);
    };
    let Ok(value) = value.to_str() else {
        return Err(StatusCode::UNAUTHORIZED);
    };
    if value == format!("Bearer {token}") {
        Ok(())
    } else {
        Err(StatusCode::UNAUTHORIZED)
    }
}

fn food_from_input(input: FoodInput, source_id: String) -> Result<Food> {
    let name = input.name.trim().to_string();
    if name.is_empty() {
        return Err(anyhow!("food name is required"));
    }

    let numeric_fields = [
        ("kcal_per_100g", input.kcal_per_100g),
        ("carbs_per_100g", input.carbs_per_100g),
        ("fat_per_100g", input.fat_per_100g),
        ("protein_per_100g", input.protein_per_100g),
        ("sugars_per_100g", input.sugars_per_100g.unwrap_or(0.0)),
        ("fiber_per_100g", input.fiber_per_100g.unwrap_or(0.0)),
        ("salt_per_100g", input.salt_per_100g.unwrap_or(0.0)),
    ];
    for (field, value) in numeric_fields {
        if value < 0.0 || !value.is_finite() {
            return Err(anyhow!("{field} must be a non-negative number"));
        }
    }

    if let Some(serving) = input.serving_size_g {
        if serving < 0.0 || !serving.is_finite() {
            return Err(anyhow!("serving_size_g must be a non-negative number"));
        }
    }

    let catalog_kind = match input.catalog_kind.as_deref() {
        Some("ingredient") => "ingredient".to_string(),
        _ => "food".to_string(),
    };

    Ok(Food {
        id: input
            .id
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| format!("food-{}", Uuid::new_v4())),
        source_id,
        name,
        brand: if catalog_kind == "ingredient" { None } else { input.brand.filter(|value| !value.trim().is_empty()) },
        catalog_kind,
        note: input.note.filter(|value| !value.trim().is_empty()),
        barcode: input.barcode.filter(|value| !value.trim().is_empty()),
        default_unit: input
            .default_unit
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| "g".into()),
        serving_size_g: input.serving_size_g,
        kcal_per_100g: input.kcal_per_100g,
        carbs_per_100g: input.carbs_per_100g,
        fat_per_100g: input.fat_per_100g,
        protein_per_100g: input.protein_per_100g,
        sugars_per_100g: input.sugars_per_100g.unwrap_or(0.0),
        fiber_per_100g: input.fiber_per_100g.unwrap_or(0.0),
        salt_per_100g: input.salt_per_100g.unwrap_or(0.0),
        updated_at: now_ms(),
        deleted_at: None,
    })
}


fn db_list_aliases_for_sync(path: &Path, since: i64) -> Result<Vec<CatalogAlias>> {
    let conn = open_conn(path)?;
    let mut stmt = conn.prepare(
        r#"SELECT kind, alias_id, canonical_id, source_id, updated_at
           FROM item_aliases
           WHERE updated_at > ?1
           ORDER BY kind, alias_id"#,
    )?;
    let rows = stmt.query_map([since], |row| {
        Ok(CatalogAlias {
            kind: row.get(0)?,
            alias_id: row.get(1)?,
            canonical_id: row.get(2)?,
            source_id: row.get(3)?,
            updated_at: row.get(4)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

fn sync_inbox_entry_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<SyncInboxEntry> {
    let summary_json: String = row.get(5)?;
    let merge_json: String = row.get(6)?;
    let payload_json: String = row.get(7)?;
    let summary = serde_json::from_str(&summary_json).unwrap_or(SyncInboxSummary { foods: 0, recipes: 0, recipe_items: 0, activities: 0, intakes: 0, weight_logs: 0, activity_logs: 0 });
    let merge_candidates = serde_json::from_str(&merge_json).unwrap_or_default();
    let payload = serde_json::from_str(&payload_json).unwrap_or(SyncPushRequest {
        source_id: None,
        device_name: None,
        sent_at: None,
        foods: Some(vec![]),
        recipes: Some(vec![]),
        recipe_items: Some(vec![]),
        activities: Some(vec![]),
        intakes: vec![],
        weight_logs: vec![],
        activity_logs: vec![],
    });
    Ok(SyncInboxEntry {
        id: row.get(0)?,
        source_id: row.get(1)?,
        device_name: row.get(2)?,
        received_at: row.get(3)?,
        status: row.get(4)?,
        summary,
        merge_candidates,
        payload,
    })
}

fn db_get_sync_inbox_entry(conn: &Connection, entry_id: &str) -> Result<SyncInboxEntry> {
    let entry = conn.query_row(
        r#"SELECT id, source_id, device_name, received_at, status, summary_json, merge_candidates_json, payload_json
           FROM sync_inbox
           WHERE id = ?1 AND status = 'pending'"#,
        params![entry_id],
        sync_inbox_entry_from_row,
    )?;
    Ok(entry)
}

fn db_list_sync_inbox(path: &Path) -> Result<Vec<SyncInboxEntry>> {
    let conn = open_conn(path)?;
    let mut stmt = conn.prepare(
        r#"SELECT id, source_id, device_name, received_at, status, summary_json, merge_candidates_json, payload_json
           FROM sync_inbox
           WHERE status = 'pending'
           ORDER BY received_at DESC"#,
    )?;
    let rows = stmt.query_map([], sync_inbox_entry_from_row)?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

fn db_list_active_foods(path: &Path) -> Result<Vec<Food>> {
    db_query_foods(path, 0, true)
}

fn db_list_foods_for_sync(path: &Path, since: i64) -> Result<Vec<Food>> {
    db_query_foods(path, since, false)
}

fn db_query_foods(path: &Path, since: i64, active_only: bool) -> Result<Vec<Food>> {
    let conn = open_conn(path)?;
    let sql = if active_only {
        r#"
        SELECT id, source_id, name, brand, catalog_kind, note, barcode, default_unit, serving_size_g,
               kcal_per_100g, carbs_per_100g, fat_per_100g, protein_per_100g,
               sugars_per_100g, fiber_per_100g, salt_per_100g, updated_at, deleted_at
        FROM foods
        WHERE updated_at > ?1 AND deleted_at IS NULL
        ORDER BY name COLLATE NOCASE
        "#
    } else {
        r#"
        SELECT id, source_id, name, brand, catalog_kind, note, barcode, default_unit, serving_size_g,
               kcal_per_100g, carbs_per_100g, fat_per_100g, protein_per_100g,
               sugars_per_100g, fiber_per_100g, salt_per_100g, updated_at, deleted_at
        FROM foods
        WHERE updated_at > ?1
        ORDER BY name COLLATE NOCASE
        "#
    };
    let mut stmt = conn.prepare(sql)?;
    let rows = stmt.query_map([since], |row| {
        Ok(Food {
            id: row.get(0)?,
            source_id: row.get(1)?,
            name: row.get(2)?,
            brand: row.get(3)?,
            catalog_kind: row.get(4)?,
            note: row.get(5)?,
            barcode: row.get(6)?,
            default_unit: row.get(7)?,
            serving_size_g: row.get(8)?,
            kcal_per_100g: row.get(9)?,
            carbs_per_100g: row.get(10)?,
            fat_per_100g: row.get(11)?,
            protein_per_100g: row.get(12)?,
            sugars_per_100g: row.get(13)?,
            fiber_per_100g: row.get(14)?,
            salt_per_100g: row.get(15)?,
            updated_at: row.get(16)?,
            deleted_at: row.get(17)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

fn db_list_active_recipes(path: &Path) -> Result<Vec<Recipe>> {
    db_query_recipes(path, 0, true)
}

fn db_list_recipes_for_sync(path: &Path, since: i64) -> Result<Vec<Recipe>> {
    db_query_recipes(path, since, false)
}

fn db_query_recipes(path: &Path, since: i64, active_only: bool) -> Result<Vec<Recipe>> {
    let conn = open_conn(path)?;
    let sql = if active_only {
        r#"
        SELECT id, source_id, name, description, note, total_weight_g, servings_count, updated_at, deleted_at
        FROM recipes
        WHERE updated_at > ?1 AND deleted_at IS NULL
        ORDER BY name COLLATE NOCASE
        "#
    } else {
        r#"
        SELECT id, source_id, name, description, note, total_weight_g, servings_count, updated_at, deleted_at
        FROM recipes
        WHERE updated_at > ?1
        ORDER BY name COLLATE NOCASE
        "#
    };
    let mut stmt = conn.prepare(sql)?;
    let rows = stmt.query_map([since], |row| {
        Ok(Recipe {
            id: row.get(0)?,
            source_id: row.get(1)?,
            name: row.get(2)?,
            description: row.get(3)?,
            note: row.get(4)?,
            total_weight_g: row.get(5)?,
            servings_count: row.get(6)?,
            updated_at: row.get(7)?,
            deleted_at: row.get(8)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

fn db_list_recipe_items(path: &Path, since: i64) -> Result<Vec<RecipeItem>> {
    let conn = open_conn(path)?;
    let mut stmt = conn.prepare(
        r#"
        SELECT id, recipe_id, food_id, amount_g, updated_at, deleted_at
        FROM recipe_items
        WHERE updated_at > ?1
        "#,
    )?;
    let rows = stmt.query_map([since], |row| {
        Ok(RecipeItem {
            id: row.get(0)?,
            recipe_id: row.get(1)?,
            food_id: row.get(2)?,
            amount_g: row.get(3)?,
            updated_at: row.get(4)?,
            deleted_at: row.get(5)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

fn db_list_recipe_details(path: &Path) -> Result<Vec<RecipeDetail>> {
    let recipes = db_list_active_recipes(path)?;
    recipes
        .into_iter()
        .map(|recipe| db_recipe_detail_from_recipe(path, recipe))
        .collect()
}

fn db_recipe_detail(path: &Path, recipe_id: &str) -> Result<RecipeDetail> {
    let conn = open_conn(path)?;
    let recipe = conn.query_row(
        r#"
        SELECT id, source_id, name, description, note, total_weight_g, servings_count, updated_at, deleted_at
        FROM recipes
        WHERE id = ?1 AND deleted_at IS NULL
        "#,
        [recipe_id],
        |row| {
            Ok(Recipe {
                id: row.get(0)?,
                source_id: row.get(1)?,
                name: row.get(2)?,
                description: row.get(3)?,
                note: row.get(4)?,
                total_weight_g: row.get(5)?,
                servings_count: row.get(6)?,
                updated_at: row.get(7)?,
                deleted_at: row.get(8)?,
            })
        },
    )?;
    db_recipe_detail_from_recipe(path, recipe)
}

fn db_recipe_detail_from_recipe(path: &Path, recipe: Recipe) -> Result<RecipeDetail> {
    let mut visited = HashSet::new();
    db_recipe_detail_from_recipe_guarded(path, recipe, &mut visited)
}

fn db_recipe_detail_from_recipe_guarded(path: &Path, recipe: Recipe, visited: &mut HashSet<String>) -> Result<RecipeDetail> {
    if !visited.insert(recipe.id.clone()) {
        return Err(anyhow!("recipe ingredient cycle detected for {}", recipe.name));
    }

    let conn = open_conn(path)?;
    let mut stmt = conn.prepare(
        r#"
        SELECT id, recipe_id, food_id, amount_g, updated_at, deleted_at
        FROM recipe_items
        WHERE recipe_id = ?1 AND deleted_at IS NULL
        ORDER BY id COLLATE NOCASE
        "#,
    )?;
    let rows = stmt.query_map([recipe.id.as_str()], |row| {
        Ok(RecipeItem {
            id: row.get(0)?,
            recipe_id: row.get(1)?,
            food_id: row.get(2)?,
            amount_g: row.get(3)?,
            updated_at: row.get(4)?,
            deleted_at: row.get(5)?,
        })
    })?;
    let raw_items = rows.collect::<rusqlite::Result<Vec<_>>>()?;
    let mut items = Vec::new();

    for item in raw_items {
        let amount_g = item.amount_g;
        if let Some(recipe_ref) = item.food_id.strip_prefix("recipe:") {
            let referenced = conn.query_row(
                r#"
                SELECT id, source_id, name, description, note, total_weight_g, servings_count, updated_at, deleted_at
                FROM recipes
                WHERE id = ?1 AND deleted_at IS NULL
                "#,
                [recipe_ref],
                |row| {
                    Ok(Recipe {
                        id: row.get(0)?,
                        source_id: row.get(1)?,
                        name: row.get(2)?,
                        description: row.get(3)?,
                        note: row.get(4)?,
                        total_weight_g: row.get(5)?,
                        servings_count: row.get(6)?,
                        updated_at: row.get(7)?,
                        deleted_at: row.get(8)?,
                    })
                },
            ).optional()?;

            if let Some(referenced_recipe) = referenced {
                let detail = db_recipe_detail_from_recipe_guarded(path, referenced_recipe, visited)?;
                items.push(RecipeItemDetail {
                    id: item.id,
                    recipe_id: item.recipe_id,
                    food_id: item.food_id,
                    food_name: format!("Recipe: {}", detail.recipe.name),
                    amount_g,
                    kcal: detail.nutrition.kcal_per_100g * amount_g / 100.0,
                    carbs: detail.nutrition.carbs_per_100g * amount_g / 100.0,
                    fat: detail.nutrition.fat_per_100g * amount_g / 100.0,
                    protein: detail.nutrition.protein_per_100g * amount_g / 100.0,
                });
            }
            continue;
        }

        let food = conn.query_row(
            r#"
            SELECT name, kcal_per_100g, carbs_per_100g, fat_per_100g, protein_per_100g
            FROM foods
            WHERE id = ?1 AND deleted_at IS NULL
            "#,
            [item.food_id.as_str()],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, f64>(1)?,
                    row.get::<_, f64>(2)?,
                    row.get::<_, f64>(3)?,
                    row.get::<_, f64>(4)?,
                ))
            },
        ).optional()?;

        if let Some((food_name, kcal_per_100g, carbs_per_100g, fat_per_100g, protein_per_100g)) = food {
            items.push(RecipeItemDetail {
                id: item.id,
                recipe_id: item.recipe_id,
                food_id: item.food_id,
                food_name,
                amount_g,
                kcal: kcal_per_100g * amount_g / 100.0,
                carbs: carbs_per_100g * amount_g / 100.0,
                fat: fat_per_100g * amount_g / 100.0,
                protein: protein_per_100g * amount_g / 100.0,
            });
        }
    }

    visited.remove(&recipe.id);
    let ingredient_weight_g: f64 = items.iter().map(|item| item.amount_g).sum();
    let total_weight_g = recipe.total_weight_g.filter(|value| value.is_finite() && *value > 0.0).unwrap_or(ingredient_weight_g);
    let kcal_total: f64 = items.iter().map(|item| item.kcal).sum();
    let carbs_total: f64 = items.iter().map(|item| item.carbs).sum();
    let fat_total: f64 = items.iter().map(|item| item.fat).sum();
    let protein_total: f64 = items.iter().map(|item| item.protein).sum();
    let multiplier = if total_weight_g > 0.0 { 100.0 / total_weight_g } else { 0.0 };

    Ok(RecipeDetail {
        recipe,
        items,
        nutrition: RecipeNutrition {
            total_weight_g,
            kcal_total,
            kcal_per_100g: kcal_total * multiplier,
            carbs_per_100g: carbs_total * multiplier,
            fat_per_100g: fat_total * multiplier,
            protein_per_100g: protein_total * multiplier,
        },
    })
}

fn upsert_food(conn: &Connection, food: &Food) -> Result<()> {
    if food.name.trim().is_empty() {
        return Err(anyhow!("food name is required"));
    }
    conn.execute(
        r#"
        INSERT INTO foods (
            id, source_id, name, brand, catalog_kind, note, barcode, default_unit, serving_size_g,
            kcal_per_100g, carbs_per_100g, fat_per_100g, protein_per_100g,
            sugars_per_100g, fiber_per_100g, salt_per_100g, updated_at, deleted_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)
        ON CONFLICT(id) DO UPDATE SET
            source_id = excluded.source_id,
            name = excluded.name,
            brand = excluded.brand,
            catalog_kind = excluded.catalog_kind,
            note = excluded.note,
            barcode = excluded.barcode,
            default_unit = excluded.default_unit,
            serving_size_g = excluded.serving_size_g,
            kcal_per_100g = excluded.kcal_per_100g,
            carbs_per_100g = excluded.carbs_per_100g,
            fat_per_100g = excluded.fat_per_100g,
            protein_per_100g = excluded.protein_per_100g,
            sugars_per_100g = excluded.sugars_per_100g,
            fiber_per_100g = excluded.fiber_per_100g,
            salt_per_100g = excluded.salt_per_100g,
            updated_at = excluded.updated_at,
            deleted_at = excluded.deleted_at
        "#,
        params![
            food.id,
            food.source_id,
            food.name,
            food.brand,
            food.catalog_kind,
            food.note,
            food.barcode,
            food.default_unit,
            food.serving_size_g,
            food.kcal_per_100g,
            food.carbs_per_100g,
            food.fat_per_100g,
            food.protein_per_100g,
            food.sugars_per_100g,
            food.fiber_per_100g,
            food.salt_per_100g,
            food.updated_at,
            food.deleted_at
        ],
    )?;
    Ok(())
}

fn parse_food_csv(db_path: &Path, csv_text: &str) -> Result<ImportPreview> {
    let conn = open_conn(db_path)?;
    let source_id = setting(&conn, "source_id")?;
    let mut reader = csv::ReaderBuilder::new()
        .trim(csv::Trim::All)
        .flexible(true)
        .from_reader(csv_text.as_bytes());

    let headers = reader.headers()?.clone();
    let mut rows = Vec::new();

    for (index, result) in reader.records().enumerate() {
        let row_number = index + 2;
        let record = result?;
        let mut errors = Vec::new();

        let name = get_csv(&headers, &record, "name").unwrap_or_default();
        if name.trim().is_empty() {
            errors.push("name is required".into());
        }

        let catalog_kind = match get_csv(&headers, &record, "catalog_kind").as_deref() { Some("ingredient") => "ingredient".to_string(), _ => "food".to_string() };
        let brand = get_csv(&headers, &record, "brand").filter(|value| !value.trim().is_empty());
        let food = Food {
            id: get_csv(&headers, &record, "id")
                .filter(|value| !value.trim().is_empty())
                .unwrap_or_else(|| format!("food-{}", Uuid::new_v4())),
            source_id: source_id.clone(),
            name,
            brand: if catalog_kind == "ingredient" { None } else { brand },
            catalog_kind,
            note: get_csv(&headers, &record, "note").filter(|value| !value.trim().is_empty()),
            barcode: get_csv(&headers, &record, "barcode").or_else(|| get_csv(&headers, &record, "ean")).or_else(|| get_csv(&headers, &record, "upc")).filter(|value| !value.trim().is_empty()),
            default_unit: get_csv(&headers, &record, "default_unit").unwrap_or_else(|| "g".into()),
            serving_size_g: parse_optional_number(&headers, &record, "serving_size_g", &mut errors),
            kcal_per_100g: parse_required_number(&headers, &record, "kcal_per_100g", &mut errors),
            carbs_per_100g: parse_required_number(&headers, &record, "carbs_per_100g", &mut errors),
            fat_per_100g: parse_required_number(&headers, &record, "fat_per_100g", &mut errors),
            protein_per_100g: parse_required_number(&headers, &record, "protein_per_100g", &mut errors),
            sugars_per_100g: parse_number_default(&headers, &record, "sugars_per_100g", 0.0, &mut errors),
            fiber_per_100g: parse_number_default(&headers, &record, "fiber_per_100g", 0.0, &mut errors),
            salt_per_100g: parse_number_default(&headers, &record, "salt_per_100g", 0.0, &mut errors),
            updated_at: now_ms(),
            deleted_at: None,
        };

        rows.push(ImportPreviewRow {
            row_number,
            food: if errors.is_empty() { Some(food) } else { None },
            errors,
        });
    }

    let valid_rows = rows.iter().filter(|row| row.errors.is_empty()).count();
    let total_rows = rows.len();
    Ok(ImportPreview {
        total_rows,
        valid_rows,
        invalid_rows: total_rows.saturating_sub(valid_rows),
        rows,
    })
}

fn get_csv(headers: &csv::StringRecord, record: &csv::StringRecord, name: &str) -> Option<String> {
    headers
        .iter()
        .position(|header| header.eq_ignore_ascii_case(name))
        .and_then(|index| record.get(index))
        .map(|value| value.trim().to_string())
}

fn parse_required_number(
    headers: &csv::StringRecord,
    record: &csv::StringRecord,
    name: &str,
    errors: &mut Vec<String>,
) -> f64 {
    match get_csv(headers, record, name) {
        Some(value) if !value.is_empty() => parse_f64(&value, name, errors).unwrap_or(0.0),
        _ => {
            errors.push(format!("{name} is required"));
            0.0
        }
    }
}

fn parse_number_default(
    headers: &csv::StringRecord,
    record: &csv::StringRecord,
    name: &str,
    default: f64,
    errors: &mut Vec<String>,
) -> f64 {
    match get_csv(headers, record, name) {
        Some(value) if !value.is_empty() => parse_f64(&value, name, errors).unwrap_or(default),
        _ => default,
    }
}

fn parse_optional_number(
    headers: &csv::StringRecord,
    record: &csv::StringRecord,
    name: &str,
    errors: &mut Vec<String>,
) -> Option<f64> {
    match get_csv(headers, record, name) {
        Some(value) if !value.is_empty() => parse_f64(&value, name, errors),
        _ => None,
    }
}

fn parse_f64(value: &str, field: &str, errors: &mut Vec<String>) -> Option<f64> {
    match value.replace(',', ".").parse::<f64>() {
        Ok(number) if number >= 0.0 => Some(number),
        Ok(_) => {
            errors.push(format!("{field} cannot be negative"));
            None
        }
        Err(_) => {
            errors.push(format!("{field} must be a number"));
            None
        }
    }
}




fn seed_default_activities(conn: &Connection) -> Result<()> {
    let now = now_ms();
    let defaults = [
        ("activity-01015", "01015", "bicycling", "general", "bicycling", 7.5, 9.4),
        ("activity-01009", "01009", "bicycling, mountain", "general", "bicycling", 8.5, 10.6),
        ("activity-01070", "01070", "unicycling", "general", "bicycling", 5.0, 6.2),
        ("activity-02010", "02010", "bicycling, stationary", "general", "conditioningExercise", 7.5, 9.4),
        ("activity-02020", "02020", "calisthenics", "vigorous effort (e.g., pushups, sit-ups, pull-ups, jumping jacks, burpees)", "conditioningExercise", 7.5, 9.4),
        ("activity-02030", "02030", "calisthenics", "light or moderate effort, general (e.g., back exercises)", "conditioningExercise", 3.5, 4.4),
        ("activity-02040", "02040", "circuit training", "including kettlebells, some aerobic movement with minimal rest, vigorous intensity", "conditioningExercise", 7.5, 9.4),
        ("activity-02050", "02050", "resistance training", "weight lifting, free weight, nautilus or universal", "conditioningExercise", 6.0, 7.5),
        ("activity-02055", "02055", "resistance training", "vigorous effort, powerlifting or bodybuilding", "conditioningExercise", 6.0, 7.5),
        ("activity-02068", "02068", "rope skipping", "general", "conditioningExercise", 12.3, 15.4),
        ("activity-02080", "02080", "rowing machine", "moderate effort", "conditioningExercise", 7.0, 8.8),
        ("activity-02090", "02090", "elliptical trainer", "moderate effort", "conditioningExercise", 5.0, 6.2),
        ("activity-02095", "02095", "stair-treadmill ergometer", "general", "conditioningExercise", 9.0, 11.2),
        ("activity-02120", "02120", "water exercise", "water aerobics, water calisthenics", "conditioningExercise", 5.3, 6.6),
        ("activity-02160", "02160", "yoga", "general, hatha", "conditioningExercise", 3.0, 3.8),
        ("activity-02165", "02165", "pilates", "general", "conditioningExercise", 3.0, 3.8),
        ("activity-02170", "02170", "stretching", "mild, general", "conditioningExercise", 2.3, 2.9),
        ("activity-02210", "02210", "high intensity interval exercise", "moderate effort", "conditioningExercise", 7.0, 8.8),
        ("activity-02214", "02214", "high intensity interval exercise", "burpees, mountain climbers, squat jumps, Tabata, vigorous effort", "conditioningExercise", 11.0, 13.8),
        ("activity-03015", "03015", "aerobic", "general", "dancing", 7.3, 9.1),
        ("activity-12020", "12020", "jogging", "general", "running", 7.0, 8.8),
        ("activity-12150", "12150", "running", "general", "running", 8.3, 10.4),
        ("activity-12180", "12180", "running", "on treadmill, general", "running", 8.0, 10.0),
        ("activity-15010", "15010", "archery", "non-hunting", "sport", 4.3, 5.4),
        ("activity-15030", "15030", "badminton", "social singles and doubles, general", "sport", 5.5, 6.9),
        ("activity-15055", "15055", "basketball", "general", "sport", 6.0, 7.5),
        ("activity-15080", "15080", "billiards", "general", "sport", 2.5, 3.1),
        ("activity-15090", "15090", "bowling", "general", "sport", 3.0, 3.8),
        ("activity-15100", "15100", "boxing", "in ring, general", "sport", 12.8, 16.0),
        ("activity-15110", "15110", "boxing", "punching bag", "sport", 5.5, 6.9),
        ("activity-15130", "15130", "broomball", "general", "sport", 7.0, 8.8),
        ("activity-15135", "15135", "children's games", "(e.g., hopscotch, 4-square, dodgeball, playground apparatus, t-ball, tetherball, marbles, arcade games), moderate effort", "sport", 5.8, 7.2),
        ("activity-15138", "15138", "cheerleading", "gymnastic moves, competitive", "sport", 6.0, 7.5),
        ("activity-15150", "15150", "cricket", "batting, bowling, fielding", "sport", 4.8, 6.0),
        ("activity-15160", "15160", "croquet", "general", "sport", 3.3, 4.1),
        ("activity-15170", "15170", "curling", "general", "sport", 4.0, 5.0),
        ("activity-15180", "15180", "darts", "wall or lawn", "sport", 2.5, 3.1),
        ("activity-15192", "15192", "auto racing", "open wheel", "sport", 8.5, 10.6),
        ("activity-15200", "15200", "fencing", "general", "sport", 6.0, 7.5),
        ("activity-15230", "15230", "football", "touch, flag, general", "sport", 8.0, 10.0),
        ("activity-15235", "15235", "football or baseball", "playing catch", "sport", 2.5, 3.1),
        ("activity-15240", "15240", "frisbee playing", "general", "sport", 3.0, 3.8),
        ("activity-15255", "15255", "golf", "general", "sport", 4.8, 6.0),
        ("activity-15300", "15300", "gymnastics", "general", "sport", 3.8, 4.8),
        ("activity-15310", "15310", "hacky sack", "general", "sport", 4.0, 5.0),
        ("activity-15320", "15320", "handball", "general", "sport", 12.0, 15.0),
        ("activity-15340", "15340", "hang gliding", "general", "sport", 3.5, 4.4),
        ("activity-15350", "15350", "hockey, field", "general", "sport", 7.8, 9.8),
        ("activity-15360", "15360", "ice hockey", "general", "sport", 8.0, 10.0),
        ("activity-15370", "15370", "horseback riding", "general", "sport", 5.5, 6.9),
        ("activity-15420", "15420", "jai alai", "general", "sport", 12.0, 15.0),
        ("activity-15425", "15425", "martial arts", "different types, slower pace, novice performers, practice", "sport", 5.3, 6.6),
        ("activity-15430", "15430", "martial arts", "different types, moderate pace (e.g., judo, jujitsu, karate, kick boxing, tae kwan do, tai-bo, Muay Thai boxing)", "sport", 10.3, 12.9),
        ("activity-15440", "15440", "juggling", "general", "sport", 4.0, 5.0),
        ("activity-15460", "15460", "lacrosse", "general", "sport", 8.0, 10.0),
        ("activity-15465", "15465", "lawn bowling", "bocce ball, outdoor", "sport", 3.3, 4.1),
        ("activity-15470", "15470", "moto-cross", "off-road motor sports, all-terrain vehicle, general", "sport", 4.0, 5.0),
        ("activity-15480", "15480", "orienteering", "general", "sport", 9.0, 11.2),
        ("activity-15500", "15500", "paddleball", "casual, general", "sport", 6.0, 7.5),
        ("activity-15510", "15510", "polo", "on horseback", "sport", 8.0, 10.0),
        ("activity-15530", "15530", "racquetball", "general", "sport", 7.0, 8.8),
        ("activity-15533", "15533", "climbing", "rock or mountain climbing", "sport", 8.0, 10.0),
        ("activity-15544", "15544", "rodeo sports", "general, moderate effort", "sport", 5.5, 6.9),
        ("activity-15551", "15551", "rope jumping", "moderate pace, 100-120 skips/min, general, 2 foot skip, plain bounce", "sport", 11.8, 14.8),
        ("activity-15560", "15560", "rugby", "union, team, competitive", "sport", 8.3, 10.4),
        ("activity-15562", "15562", "rugby", "touch, non-competitive", "sport", 6.3, 7.9),
        ("activity-15570", "15570", "shuffleboard", "general", "sport", 3.0, 3.8),
        ("activity-15580", "15580", "skateboarding", "general, moderate effort", "sport", 5.0, 6.2),
        ("activity-15590", "15590", "skating", "roller", "sport", 7.0, 8.8),
        ("activity-15592", "15592", "rollerblading", "in-line skating, 14.4 km/h (9.0 mph), recreational pace", "sport", 7.5, 9.4),
        ("activity-15600", "15600", "skydiving", "skydiving, base jumping, bungee jumping", "sport", 3.5, 4.4),
        ("activity-15610", "15610", "soccer", "casual, general", "sport", 7.0, 8.8),
        ("activity-15620", "15620", "softball / baseball", "fast or slow pitch, general", "sport", 5.0, 6.2),
        ("activity-15652", "15652", "squash", "general", "sport", 7.3, 9.1),
        ("activity-15660", "15660", "table tennis", "table tennis, ping pong", "sport", 4.0, 5.0),
        ("activity-15670", "15670", "tai chi, qi gong", "general", "sport", 3.5, 4.4),
        ("activity-15675", "15675", "tennis", "general", "sport", 7.3, 9.1),
        ("activity-15700", "15700", "trampoline", "recreational", "sport", 3.5, 4.4),
        ("activity-15710", "15710", "volleyball", "non-competitive, 6 - 9 member team, general", "sport", 4.0, 5.0),
        ("activity-15730", "15730", "wrestling", "general", "sport", 6.0, 7.5),
        ("activity-15731", "15731", "wallyball", "general", "sport", 7.0, 8.8),
        ("activity-15732", "15732", "track and field", "(e.g. shot, discus, hammer throw)", "sport", 4.0, 5.0),
        ("activity-15733", "15733", "track and field", "(e.g. high jump, long jump, triple jump, javelin, pole vault)", "sport", 6.0, 7.5),
        ("activity-15734", "15734", "track and field", "(e.g. steeplechase, hurdles)", "sport", 10.0, 12.5),
        ("activity-15740", "15740", "pickleball", "general", "sport", 4.8, 6.0),
        ("activity-15750", "15750", "active video games", "Wii Sports, Dance Dance Revolution, general", "sport", 3.0, 3.8),
        ("activity-17010", "17010", "backpacking", "general", "sport", 7.0, 8.8),
        ("activity-17080", "17080", "hiking", "cross country", "sport", 6.0, 7.5),
        ("activity-17160", "17160", "walking", "for pleasure", "sport", 3.5, 4.4),
        ("activity-17165", "17165", "walking the dog", "general", "sport", 3.0, 3.8),
        ("activity-17170", "17170", "Nordic walking", "general", "sport", 4.8, 6.0),
        ("activity-18070", "18070", "canoeing", "rowing, for pleasure, general", "waterActivities", 3.5, 4.4),
        ("activity-18090", "18090", "diving", "springboard or platform", "waterActivities", 3.0, 3.8),
        ("activity-18100", "18100", "kayaking", "moderate effort", "waterActivities", 5.0, 6.2),
        ("activity-18110", "18110", "paddle boat", "general", "waterActivities", 4.0, 5.0),
        ("activity-18120", "18120", "sailing", "boat and board sailing, windsurfing, ice sailing, general", "waterActivities", 3.0, 3.8),
        ("activity-18150", "18150", "water skiing", "water or wakeboarding", "waterActivities", 6.0, 7.5),
        ("activity-18200", "18200", "diving", "skindiving, scuba diving, general", "waterActivities", 7.0, 8.8),
        ("activity-18210", "18210", "snorkeling", "general", "waterActivities", 5.0, 6.2),
        ("activity-18220", "18220", "surfing", "body or board, general", "waterActivities", 3.0, 3.8),
        ("activity-18225", "18225", "paddle boarding", "standing", "waterActivities", 6.0, 7.5),
        ("activity-18350", "18350", "swimming", "treading water, moderate effort, general", "waterActivities", 3.5, 4.4),
        ("activity-18355", "18355", "water aerobics", "water aerobics, water calisthenics", "waterActivities", 5.5, 6.9),
        ("activity-18360", "18360", "water polo", "general", "waterActivities", 10.0, 12.5),
        ("activity-19030", "19030", "ice skating", "general", "winterActivities", 7.0, 8.8),
        ("activity-19075", "19075", "skiing", "general", "winterActivities", 7.0, 8.8),
        ("activity-19080", "19080", "skiing", "cross-country, general", "winterActivities", 7.0, 8.8),
        ("activity-19252", "19252", "snow shoveling", "by hand, moderate effort", "winterActivities", 5.3, 6.6),
        ("activity-19260", "19260", "snowshoeing", "general", "winterActivities", 5.3, 6.6),
    ];
    for (id, code, name, description, activity_type, met, kcal_per_min) in defaults {
        conn.execute(
            r#"
            INSERT INTO activities (id, code, name, description, activity_type, met, kcal_per_min, updated_at, deleted_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, NULL)
            ON CONFLICT(id) DO NOTHING
            "#,
            params![id, code, name, description, activity_type, met, kcal_per_min, now],
        )?;
    }
    Ok(())
}

fn activity_from_input(input: ActivityInput) -> Result<ActivityDefinition> {
    let name = input.name.trim().to_string();
    if name.is_empty() { return Err(anyhow!("activity name is required")); }
    if input.met < 0.0 || !input.met.is_finite() { return Err(anyhow!("MET must be a non-negative number")); }
    if input.kcal_per_min < 0.0 || !input.kcal_per_min.is_finite() { return Err(anyhow!("kcal_per_min must be a non-negative number")); }
    Ok(ActivityDefinition {
        id: input.id.filter(|value| !value.trim().is_empty()).unwrap_or_else(|| format!("activity-{}", Uuid::new_v4())),
        code: input.code.filter(|value| !value.trim().is_empty()).unwrap_or_else(|| "custom".into()),
        name,
        description: input.description.filter(|value| !value.trim().is_empty()),
        activity_type: input.activity_type.filter(|value| !value.trim().is_empty()).unwrap_or_else(|| "custom".into()),
        met: input.met,
        kcal_per_min: input.kcal_per_min,
        updated_at: now_ms(),
        deleted_at: None,
    })
}

fn upsert_activity(conn: &Connection, activity: &ActivityDefinition) -> Result<()> {
    conn.execute(
        r#"
        INSERT INTO activities (id, code, name, description, activity_type, met, kcal_per_min, updated_at, deleted_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
        ON CONFLICT(id) DO UPDATE SET
            code = excluded.code,
            name = excluded.name,
            description = excluded.description,
            activity_type = excluded.activity_type,
            met = excluded.met,
            kcal_per_min = excluded.kcal_per_min,
            updated_at = excluded.updated_at,
            deleted_at = excluded.deleted_at
        "#,
        params![activity.id, activity.code, activity.name, activity.description, activity.activity_type, activity.met, activity.kcal_per_min, activity.updated_at, activity.deleted_at],
    )?;
    Ok(())
}

fn db_list_active_activities(path: &Path) -> Result<Vec<ActivityDefinition>> {
    db_query_activities(path, 0, true)
}

fn db_list_activities_for_sync(path: &Path, since: i64) -> Result<Vec<ActivityDefinition>> {
    db_query_activities(path, since, false)
}

fn db_query_activities(path: &Path, since: i64, active_only: bool) -> Result<Vec<ActivityDefinition>> {
    let conn = open_conn(path)?;
    let sql = if active_only {
        r#"
        SELECT id, code, name, description, activity_type, met, kcal_per_min, updated_at, deleted_at
        FROM activities
        WHERE updated_at > ?1 AND deleted_at IS NULL
        ORDER BY name COLLATE NOCASE
        "#
    } else {
        r#"
        SELECT id, code, name, description, activity_type, met, kcal_per_min, updated_at, deleted_at
        FROM activities
        WHERE updated_at > ?1
        ORDER BY name COLLATE NOCASE
        "#
    };
    let mut stmt = conn.prepare(sql)?;
    let rows = stmt.query_map([since], |row| {
        Ok(ActivityDefinition {
            id: row.get(0)?,
            code: row.get(1)?,
            name: row.get(2)?,
            description: row.get(3)?,
            activity_type: row.get(4)?,
            met: row.get(5)?,
            kcal_per_min: row.get(6)?,
            updated_at: row.get(7)?,
            deleted_at: row.get(8)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

fn db_catalog_revision(path: &Path) -> Result<i64> {
    let conn = open_conn(path)?;
    let mut max_value = 0_i64;
    for table in ["foods", "recipes", "recipe_items", "activities", "item_aliases"] {
        let sql = format!("SELECT COALESCE(MAX(updated_at), 0) FROM {table}");
        let value: i64 = conn.query_row(&sql, [], |row| row.get(0)).unwrap_or(0);
        if value > max_value { max_value = value; }
    }
    Ok(max_value)
}

fn stringify_error(error: impl std::fmt::Display) -> String {
    error.to_string()
}
