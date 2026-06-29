use serde::Serialize;
use std::sync::Mutex;
use tauri::{AppHandle, State};
use tauri_plugin_updater::{Update, UpdaterExt};

#[derive(Default)]
pub struct PendingUpdate(pub Mutex<Option<Update>>);

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub version: String,
    pub current_version: String,
    pub body: Option<String>,
    pub date: Option<String>,
}

#[tauri::command]
pub async fn check_for_updates(
    app: AppHandle,
    pending_update: State<'_, PendingUpdate>,
) -> Result<Option<UpdateInfo>, String> {
    let update = app
        .updater_builder()
        .build()
        .map_err(to_string)?
        .check()
        .await
        .map_err(to_string)?;

    let info = update.as_ref().map(|update| UpdateInfo {
        version: update.version.clone(),
        current_version: update.current_version.clone(),
        body: None,
        date: None,
    });

    *pending_update
        .0
        .lock()
        .map_err(|_| "Pending update lock is poisoned.".to_string())? = update;

    Ok(info)
}

#[tauri::command]
pub async fn install_update(
    app: AppHandle,
    pending_update: State<'_, PendingUpdate>,
) -> Result<(), String> {
    let Some(update) = pending_update
        .0
        .lock()
        .map_err(|_| "Pending update lock is poisoned.".to_string())?
        .take()
    else {
        return Err("No pending update is available.".to_string());
    };

    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(to_string)?;

    app.request_restart();
    Ok(())
}

fn to_string(error: impl ToString) -> String {
    error.to_string()
}
