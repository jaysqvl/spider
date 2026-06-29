use serde_json::Value;
use tauri::{AppHandle, State};

use crate::storage::{
    self, CompletedGameRecord, LoadAppState, SettingsPayload, StatsPayload, StorageState,
};

#[tauri::command]
pub fn load_app_state(
    app: AppHandle,
    state: State<'_, StorageState>,
) -> Result<LoadAppState, String> {
    let version = app.package_info().version.to_string();
    storage::load_app_state(&state, version)
}

#[tauri::command]
pub fn save_active_game(state: State<'_, StorageState>, game: Value) -> Result<(), String> {
    storage::save_active_game(&state, game)
}

#[tauri::command]
pub fn clear_active_game(state: State<'_, StorageState>) -> Result<(), String> {
    storage::clear_active_game(&state)
}

#[tauri::command]
pub fn record_completed_game(
    state: State<'_, StorageState>,
    record: CompletedGameRecord,
) -> Result<StatsPayload, String> {
    storage::record_completed_game(&state, record)
}

#[tauri::command]
pub fn load_settings(state: State<'_, StorageState>) -> Result<SettingsPayload, String> {
    storage::load_settings(&state)
}

#[tauri::command]
pub fn save_settings(
    state: State<'_, StorageState>,
    settings: SettingsPayload,
) -> Result<(), String> {
    storage::save_settings(&state, settings)
}

#[tauri::command]
pub fn load_stats(state: State<'_, StorageState>) -> Result<StatsPayload, String> {
    storage::load_stats(&state)
}

#[tauri::command]
pub fn reset_local_data(state: State<'_, StorageState>) -> Result<(), String> {
    storage::reset_local_data(&state)
}
