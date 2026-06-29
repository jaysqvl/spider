use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};

const DATABASE_FILE: &str = "spider.sqlite3";
const GAME_SCALE_MIN: i64 = 70;
const GAME_SCALE_MAX: i64 = 100;
const GAME_SCALE_STEP: i64 = 5;
const GAME_SCALE_DEFAULT: i64 = 100;
const GAME_SCALE_MODE_DEFAULT: &str = "auto";

pub struct StorageState {
    conn: Mutex<Connection>,
    recovery_message: Mutex<Option<String>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadAppState {
    pub settings: SettingsPayload,
    pub active_game: Option<Value>,
    pub stats: StatsPayload,
    pub recovery_message: Option<String>,
    pub app_version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsPayload {
    pub theme: String,
    pub difficulty: String,
    pub card_back: String,
    #[serde(default = "default_game_scale")]
    pub game_scale: i64,
    #[serde(default = "default_game_scale_mode")]
    pub game_scale_mode: String,
    pub reduced_motion: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompletedGameRecord {
    pub difficulty: String,
    pub seed: String,
    pub outcome: String,
    pub score: i64,
    pub moves: i64,
    pub elapsed_ms: i64,
    pub started_at: String,
    pub completed_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatsPayload {
    pub rollups: Vec<StatsRollup>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatsRollup {
    pub scope: String,
    pub difficulty: String,
    pub games_played: i64,
    pub games_won: i64,
    pub games_abandoned: i64,
    pub best_score: Option<i64>,
    pub best_time_ms: Option<i64>,
    pub total_moves: i64,
    pub total_elapsed_ms: i64,
}

pub fn initialize(app: &AppHandle) -> Result<StorageState, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Unable to resolve app data directory: {error}"))?;
    fs::create_dir_all(&data_dir)
        .map_err(|error| format!("Unable to create app data directory: {error}"))?;

    let db_path = data_dir.join(DATABASE_FILE);

    match open_checked_database(&db_path) {
        Ok(conn) => Ok(StorageState {
            conn: Mutex::new(conn),
            recovery_message: Mutex::new(None),
        }),
        Err(error) => recover_database(&db_path, error),
    }
}

pub fn load_app_state(state: &StorageState, app_version: String) -> Result<LoadAppState, String> {
    Ok(LoadAppState {
        settings: load_settings(state)?,
        active_game: load_active_game(state)?,
        stats: load_stats(state)?,
        recovery_message: take_recovery_message(state)?,
        app_version,
    })
}

pub fn save_active_game(state: &StorageState, game: Value) -> Result<(), String> {
    let difficulty = string_field(&game, "difficulty")?;
    let seed = string_field(&game, "seed")?;
    let state_version = integer_field(&game, "stateVersion")?;
    let score = integer_field(&game, "score")?;
    let moves = integer_field(&game, "moves")?;
    let elapsed_ms = integer_field(&game, "elapsedMs")?;
    let started_at = string_field(&game, "startedAt")?;
    let updated_at = string_field(&game, "updatedAt")?;
    let snapshot = game.to_string();
    let mut conn = lock_connection(state)?;
    let tx = conn.transaction().map_err(to_string)?;

    tx.execute(
        "INSERT INTO active_game (
            id, difficulty, seed, state_version, score, moves, elapsed_ms,
            started_at, updated_at, snapshot_json
        ) VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
        ON CONFLICT(id) DO UPDATE SET
            difficulty = excluded.difficulty,
            seed = excluded.seed,
            state_version = excluded.state_version,
            score = excluded.score,
            moves = excluded.moves,
            elapsed_ms = excluded.elapsed_ms,
            started_at = excluded.started_at,
            updated_at = excluded.updated_at,
            snapshot_json = excluded.snapshot_json",
        params![
            difficulty,
            seed,
            state_version,
            score,
            moves,
            elapsed_ms,
            started_at,
            updated_at,
            snapshot
        ],
    )
    .map_err(to_string)?;

    tx.commit().map_err(to_string)
}

pub fn clear_active_game(state: &StorageState) -> Result<(), String> {
    let conn = lock_connection(state)?;
    conn.execute("DELETE FROM active_game WHERE id = 1", [])
        .map(|_| ())
        .map_err(to_string)
}

pub fn load_settings(state: &StorageState) -> Result<SettingsPayload, String> {
    let conn = lock_connection(state)?;
    let raw = conn
        .query_row(
            "SELECT value_json FROM settings WHERE key = 'settings'",
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(to_string)?;

    let Some(raw_settings) = raw else {
        return Ok(default_settings());
    };

    serde_json::from_str::<SettingsPayload>(&raw_settings)
        .map(normalize_settings)
        .or_else(|_| Ok(default_settings()))
}

pub fn save_settings(state: &StorageState, settings: SettingsPayload) -> Result<(), String> {
    let serialized = serde_json::to_string(&normalize_settings(settings)).map_err(to_string)?;
    let mut conn = lock_connection(state)?;
    let tx = conn.transaction().map_err(to_string)?;

    tx.execute(
        "INSERT INTO settings (key, value_json, updated_at)
         VALUES ('settings', ?1, CURRENT_TIMESTAMP)
         ON CONFLICT(key) DO UPDATE SET
            value_json = excluded.value_json,
            updated_at = excluded.updated_at",
        params![serialized],
    )
    .map_err(to_string)?;

    tx.commit().map_err(to_string)
}

pub fn record_completed_game(
    state: &StorageState,
    record: CompletedGameRecord,
) -> Result<StatsPayload, String> {
    if record.outcome != "won" && record.outcome != "abandoned" {
        return Err("Completed game outcome must be won or abandoned.".to_string());
    }

    let mut conn = lock_connection(state)?;
    let tx = conn.transaction().map_err(to_string)?;

    tx.execute(
        "INSERT INTO completed_games (
            difficulty, seed, outcome, score, moves, elapsed_ms, started_at, completed_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            record.difficulty,
            record.seed,
            record.outcome,
            record.score,
            record.moves,
            record.elapsed_ms,
            record.started_at,
            record.completed_at
        ],
    )
    .map_err(to_string)?;

    update_rollup(&tx, "all", "all", &record)?;
    update_rollup(&tx, "difficulty", &record.difficulty, &record)?;
    tx.commit().map_err(to_string)?;

    load_stats(state)
}

pub fn load_stats(state: &StorageState) -> Result<StatsPayload, String> {
    let conn = lock_connection(state)?;
    let mut statement = conn
        .prepare(
            "SELECT scope, difficulty, games_played, games_won, games_abandoned,
                    best_score, best_time_ms, total_moves, total_elapsed_ms
             FROM stats_rollups
             ORDER BY CASE scope WHEN 'all' THEN 0 ELSE 1 END, difficulty",
        )
        .map_err(to_string)?;
    let rollups = statement
        .query_map([], |row| {
            Ok(StatsRollup {
                scope: row.get(0)?,
                difficulty: row.get(1)?,
                games_played: row.get(2)?,
                games_won: row.get(3)?,
                games_abandoned: row.get(4)?,
                best_score: row.get(5)?,
                best_time_ms: row.get(6)?,
                total_moves: row.get(7)?,
                total_elapsed_ms: row.get(8)?,
            })
        })
        .map_err(to_string)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(to_string)?;

    if rollups.is_empty() {
        return Ok(StatsPayload {
            rollups: vec![empty_rollup("all", "all")],
        });
    }

    Ok(StatsPayload { rollups })
}

pub fn reset_local_data(state: &StorageState) -> Result<(), String> {
    let mut conn = lock_connection(state)?;
    let tx = conn.transaction().map_err(to_string)?;

    tx.execute("DELETE FROM active_game", [])
        .map_err(to_string)?;
    tx.execute("DELETE FROM settings", []).map_err(to_string)?;
    tx.execute("DELETE FROM completed_games", [])
        .map_err(to_string)?;
    tx.execute("DELETE FROM stats_rollups", [])
        .map_err(to_string)?;

    tx.commit().map_err(to_string)
}

fn load_active_game(state: &StorageState) -> Result<Option<Value>, String> {
    let conn = lock_connection(state)?;
    let raw = conn
        .query_row(
            "SELECT snapshot_json FROM active_game WHERE id = 1",
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(to_string)?;

    raw.map(|snapshot| serde_json::from_str::<Value>(&snapshot).map_err(to_string))
        .transpose()
}

fn open_checked_database(path: &Path) -> Result<Connection, String> {
    let conn = Connection::open(path).map_err(to_string)?;
    let quick_check = conn
        .query_row("PRAGMA quick_check", [], |row| row.get::<_, String>(0))
        .map_err(to_string)?;

    if quick_check != "ok" {
        return Err(format!("SQLite quick_check failed: {quick_check}"));
    }

    run_migrations(&conn)?;
    Ok(conn)
}

fn recover_database(path: &Path, cause: String) -> Result<StorageState, String> {
    let backup_path = backup_corrupt_database(path)?;
    let conn = open_checked_database(path)?;
    let recovery_message = backup_path.map(|path| {
        format!(
            "Local database was recovered after an error ({cause}). Backup saved as {}.",
            path.display()
        )
    });

    Ok(StorageState {
        conn: Mutex::new(conn),
        recovery_message: Mutex::new(recovery_message),
    })
}

fn backup_corrupt_database(path: &Path) -> Result<Option<PathBuf>, String> {
    if !path.exists() {
        return Ok(None);
    }

    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(to_string)?
        .as_secs();
    let backup_path = path.with_file_name(format!("spider-corrupt-{timestamp}.sqlite3"));
    fs::rename(path, &backup_path)
        .map_err(|error| format!("Unable to back up corrupted database: {error}"))?;
    Ok(Some(backup_path))
}

fn run_migrations(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_migrations (
            id TEXT PRIMARY KEY,
            applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );",
    )
    .map_err(to_string)?;

    for (id, sql) in migrations() {
        let exists = conn
            .query_row(
                "SELECT 1 FROM schema_migrations WHERE id = ?1",
                params![id],
                |_| Ok(()),
            )
            .optional()
            .map_err(to_string)?
            .is_some();

        if exists {
            continue;
        }

        let tx = conn.unchecked_transaction().map_err(to_string)?;
        tx.execute_batch(sql).map_err(to_string)?;
        tx.execute(
            "INSERT INTO schema_migrations (id, applied_at) VALUES (?1, CURRENT_TIMESTAMP)",
            params![id],
        )
        .map_err(to_string)?;
        tx.commit().map_err(to_string)?;
    }

    Ok(())
}

fn migrations() -> Vec<(&'static str, &'static str)> {
    vec![(
        "001_initial_local_data",
        "CREATE TABLE settings (
            key TEXT PRIMARY KEY,
            value_json TEXT NOT NULL,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE active_game (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            difficulty TEXT NOT NULL,
            seed TEXT NOT NULL,
            state_version INTEGER NOT NULL,
            score INTEGER NOT NULL,
            moves INTEGER NOT NULL,
            elapsed_ms INTEGER NOT NULL,
            started_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            snapshot_json TEXT NOT NULL
        );

        CREATE TABLE completed_games (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            difficulty TEXT NOT NULL,
            seed TEXT NOT NULL,
            outcome TEXT NOT NULL CHECK (outcome IN ('won', 'abandoned')),
            score INTEGER NOT NULL,
            moves INTEGER NOT NULL,
            elapsed_ms INTEGER NOT NULL,
            started_at TEXT NOT NULL,
            completed_at TEXT NOT NULL
        );

        CREATE INDEX completed_games_difficulty_idx
            ON completed_games (difficulty, completed_at);

        CREATE TABLE stats_rollups (
            scope TEXT NOT NULL,
            difficulty TEXT NOT NULL,
            games_played INTEGER NOT NULL DEFAULT 0,
            games_won INTEGER NOT NULL DEFAULT 0,
            games_abandoned INTEGER NOT NULL DEFAULT 0,
            best_score INTEGER,
            best_time_ms INTEGER,
            total_moves INTEGER NOT NULL DEFAULT 0,
            total_elapsed_ms INTEGER NOT NULL DEFAULT 0,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (scope, difficulty)
        );",
    )]
}

fn update_rollup(
    tx: &rusqlite::Transaction<'_>,
    scope: &str,
    difficulty: &str,
    record: &CompletedGameRecord,
) -> Result<(), String> {
    tx.execute(
        "INSERT INTO stats_rollups (scope, difficulty)
         VALUES (?1, ?2)
         ON CONFLICT(scope, difficulty) DO NOTHING",
        params![scope, difficulty],
    )
    .map_err(to_string)?;

    tx.execute(
        "UPDATE stats_rollups SET
            games_played = games_played + 1,
            games_won = games_won + CASE WHEN ?3 = 'won' THEN 1 ELSE 0 END,
            games_abandoned = games_abandoned + CASE WHEN ?3 = 'abandoned' THEN 1 ELSE 0 END,
            best_score = CASE
                WHEN ?3 = 'won' AND (best_score IS NULL OR ?4 > best_score) THEN ?4
                ELSE best_score
            END,
            best_time_ms = CASE
                WHEN ?3 = 'won' AND (best_time_ms IS NULL OR ?5 < best_time_ms) THEN ?5
                ELSE best_time_ms
            END,
            total_moves = total_moves + ?6,
            total_elapsed_ms = total_elapsed_ms + ?5,
            updated_at = CURRENT_TIMESTAMP
         WHERE scope = ?1 AND difficulty = ?2",
        params![
            scope,
            difficulty,
            record.outcome,
            record.score,
            record.elapsed_ms,
            record.moves
        ],
    )
    .map(|_| ())
    .map_err(to_string)
}

fn empty_rollup(scope: &str, difficulty: &str) -> StatsRollup {
    StatsRollup {
        scope: scope.to_string(),
        difficulty: difficulty.to_string(),
        games_played: 0,
        games_won: 0,
        games_abandoned: 0,
        best_score: None,
        best_time_ms: None,
        total_moves: 0,
        total_elapsed_ms: 0,
    }
}

fn default_settings() -> SettingsPayload {
    serde_json::from_value(json!({
        "theme": "system",
        "difficulty": "one-suit",
        "cardBack": "spruce",
        "gameScale": GAME_SCALE_DEFAULT,
        "gameScaleMode": GAME_SCALE_MODE_DEFAULT,
        "reducedMotion": false
    }))
    .expect("default settings are valid")
}

fn normalize_settings(settings: SettingsPayload) -> SettingsPayload {
    SettingsPayload {
        game_scale: normalize_game_scale(settings.game_scale),
        game_scale_mode: normalize_game_scale_mode(&settings.game_scale_mode).to_string(),
        ..settings
    }
}

fn normalize_game_scale(value: i64) -> i64 {
    let bounded = value.clamp(GAME_SCALE_MIN, GAME_SCALE_MAX);
    let stepped = ((bounded + GAME_SCALE_STEP / 2) / GAME_SCALE_STEP) * GAME_SCALE_STEP;
    stepped.clamp(GAME_SCALE_MIN, GAME_SCALE_MAX)
}

fn default_game_scale() -> i64 {
    GAME_SCALE_DEFAULT
}

fn default_game_scale_mode() -> String {
    GAME_SCALE_MODE_DEFAULT.to_string()
}

fn normalize_game_scale_mode(value: &str) -> &str {
    if value == "auto" || value == "manual" {
        value
    } else {
        GAME_SCALE_MODE_DEFAULT
    }
}

fn take_recovery_message(state: &StorageState) -> Result<Option<String>, String> {
    let mut recovery = state
        .recovery_message
        .lock()
        .map_err(|_| "Storage recovery message lock is poisoned.".to_string())?;
    Ok(recovery.take())
}

fn lock_connection(state: &StorageState) -> Result<std::sync::MutexGuard<'_, Connection>, String> {
    state
        .conn
        .lock()
        .map_err(|_| "Storage connection lock is poisoned.".to_string())
}

fn string_field(value: &Value, key: &str) -> Result<String, String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(ToString::to_string)
        .ok_or_else(|| format!("Missing string field `{key}` in active game payload."))
}

fn integer_field(value: &Value, key: &str) -> Result<i64, String> {
    value
        .get(key)
        .and_then(Value::as_i64)
        .ok_or_else(|| format!("Missing integer field `{key}` in active game payload."))
}

fn to_string(error: impl ToString) -> String {
    error.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn legacy_settings_default_game_scale() {
        let settings: SettingsPayload = serde_json::from_value(json!({
            "theme": "dark",
            "difficulty": "one-suit",
            "cardBack": "spruce",
            "reducedMotion": true
        }))
        .expect("legacy settings should deserialize");

        assert_eq!(settings.game_scale, 100);
        assert_eq!(settings.game_scale_mode, "auto");
    }

    #[test]
    fn settings_keep_saved_game_scale_and_mode() {
        let settings: SettingsPayload = serde_json::from_value(json!({
            "theme": "dark",
            "difficulty": "one-suit",
            "cardBack": "spruce",
            "gameScale": 85,
            "gameScaleMode": "manual",
            "reducedMotion": true
        }))
        .expect("settings should deserialize");

        assert_eq!(settings.game_scale, 85);
        assert_eq!(settings.game_scale_mode, "manual");
    }

    #[test]
    fn settings_normalize_out_of_range_game_scale() {
        let settings = normalize_settings(
            serde_json::from_value(json!({
                "theme": "dark",
                "difficulty": "one-suit",
                "cardBack": "spruce",
                "gameScale": 999,
                "gameScaleMode": "auto",
                "reducedMotion": true
            }))
            .expect("settings should deserialize"),
        );

        assert_eq!(settings.game_scale, 100);
    }

    #[test]
    fn settings_normalize_old_oversized_game_scale() {
        let settings = normalize_settings(
            serde_json::from_value(json!({
                "theme": "dark",
                "difficulty": "one-suit",
                "cardBack": "spruce",
                "gameScale": 120,
                "gameScaleMode": "auto",
                "reducedMotion": true
            }))
            .expect("settings should deserialize"),
        );

        assert_eq!(settings.game_scale, 100);
    }

    #[test]
    fn settings_normalize_invalid_game_scale_mode() {
        let settings = normalize_settings(
            serde_json::from_value(json!({
                "theme": "dark",
                "difficulty": "one-suit",
                "cardBack": "spruce",
                "gameScale": 90,
                "gameScaleMode": "huge",
                "reducedMotion": true
            }))
            .expect("settings should deserialize"),
        );

        assert_eq!(settings.game_scale_mode, "auto");
    }
}
