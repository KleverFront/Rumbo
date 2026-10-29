use tauri_plugin_sql::{Migration, MigrationKind};

pub const DB_URL: &str = "sqlite:rumbo.db";

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(DB_URL, migrations())
                .build(),
        )
        .invoke_handler(tauri::generate_handler![db_url])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
