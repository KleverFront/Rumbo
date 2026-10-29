use tauri_plugin_sql::{Migration, MigrationKind};

pub const DB_URL: &str = "sqlite:rumbo.db";

const KEYCHAIN_SERVICE: &str = "com.rumbo.app";
// Only these names can be read or written, so the UI cannot touch other Keychain items.
const SECRET_NAMES: [&str; 4] = ["anthropic", "deepseek", "gemini", "adzuna"];

fn migrations() -> Vec<Migration> {
    vec![
        Migration {
            version: 1,
            description: "init",
            sql: include_str!("../migrations/001_init.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "updated_at_triggers",
            sql: include_str!("../migrations/002_updated_at_triggers.sql"),
            kind: MigrationKind::Up,
        },
    ]
}

/// Single source of truth for the DB URL, so the UI opens the migrated database.
#[tauri::command]
fn db_url() -> &'static str {
    DB_URL
}

fn keychain_entry(name: &str) -> Result<keyring::Entry, String> {
    if !SECRET_NAMES.contains(&name) {
        return Err(format!("unknown secret: {name}"));
    }
    keyring::Entry::new(KEYCHAIN_SERVICE, name).map_err(|e| e.to_string())
}

#[tauri::command]
fn secret_get(name: String) -> Result<Option<String>, String> {
    match keychain_entry(&name)?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

/// Stores a secret in the macOS Keychain; an empty value deletes it.
#[tauri::command]
fn secret_set(name: String, value: String) -> Result<(), String> {
    let entry = keychain_entry(&name)?;
    if value.is_empty() {
        return match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(e.to_string()),
        };
    }
    entry.set_password(&value).map_err(|e| e.to_string())
}

/// Writes an exported PDF to the path the user picked in the save dialog.
/// Limited to absolute .pdf paths so the webview cannot use it to overwrite config or launch files.
#[tauri::command]
fn save_file(path: String, bytes: Vec<u8>) -> Result<(), String> {
    let target = std::path::Path::new(&path);
    let is_pdf = target
        .extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("pdf"));
    if !target.is_absolute() || !is_pdf {
        return Err(format!("only .pdf files can be saved: {path}"));
    }
    std::fs::write(target, bytes).map_err(|e| format!("{path}: {e}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(DB_URL, migrations())
                .build(),
        )
        .invoke_handler(tauri::generate_handler![db_url, secret_get, secret_set, save_file])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
