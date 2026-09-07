use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tauri::{ipc::Channel, AppHandle};
use tauri_plugin_updater::{Update, UpdaterExt};

static INSTALLING: AtomicBool = AtomicBool::new(false);
struct InstallGuard;
impl Drop for InstallGuard {
    fn drop(&mut self) {
        INSTALLING.store(false, Ordering::SeqCst);
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    version: String,
    current_version: String,
    notes: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProgress {
    downloaded: u64,
    total: Option<u64>,
    phase: &'static str,
}

async fn checked_update(app: &AppHandle) -> Result<Option<Update>, String> {
    app.updater_builder()
        .timeout(Duration::from_secs(25))
        .build()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| format!("无法连接更新服务，请稍后重试：{e}"))
}

#[tauri::command]
pub fn desktop_update_status(app: AppHandle) -> serde_json::Value {
    serde_json::json!({"supported": cfg!(target_os = "windows"), "version": app.package_info().version.to_string()})
}

#[tauri::command]
pub async fn check_desktop_update(app: AppHandle) -> Result<Option<UpdateInfo>, String> {
    if !cfg!(target_os = "windows") {
        return Ok(None);
    }
    Ok(checked_update(&app).await?.map(|update| UpdateInfo {
        version: update.version,
        current_version: update.current_version,
        notes: update.body.unwrap_or_default(),
    }))
}

#[tauri::command]
pub async fn install_desktop_update(
    app: AppHandle,
    expected_version: String,
    on_event: Channel<UpdateProgress>,
) -> Result<(), String> {
    if !cfg!(target_os = "windows") {
        return Err("当前仅提供 Windows 自动更新".into());
    }
    if INSTALLING.swap(true, Ordering::SeqCst) {
        return Err("更新已在进行中".into());
    }
    let _guard = InstallGuard;
    if !super::extraction_tokens()
        .lock()
        .map_err(|_| "任务状态不可用")?
        .is_empty()
    {
        return Err("请先停止视频处理，再安装更新".into());
    }
    // Do not accept download URLs or signatures from the webview. Recheck the
    // configured HTTPS feed and require the exact version accepted by the user.
    let mut update = checked_update(&app).await?.ok_or("当前已是最新版本")?;
    if update.version != expected_version {
        return Err("可用版本发生变化，请重新检查更新".into());
    }
    update.timeout = Some(Duration::from_secs(900));
    let mut downloaded = 0u64;
    let mut last_emit = std::time::Instant::now() - Duration::from_secs(1);
    let bytes = update
        .download(
            |chunk, total| {
                downloaded += chunk as u64;
                if last_emit.elapsed() >= Duration::from_millis(200) {
                    let _ = on_event.send(UpdateProgress {
                        downloaded,
                        total,
                        phase: "download",
                    });
                    last_emit = std::time::Instant::now();
                }
            },
            || {},
        )
        .await
        .map_err(|e| format!("下载或签名校验失败：{e}"))?;
    let _ = on_event.send(UpdateProgress {
        downloaded: bytes.len() as u64,
        total: Some(bytes.len() as u64),
        phase: "install",
    });
    // Tauri verifies the package signature in download(), and on Windows exits
    // this app only after the installer was launched successfully.
    update
        .install(bytes)
        .map_err(|e| format!("无法启动更新安装程序：{e}"))
}
