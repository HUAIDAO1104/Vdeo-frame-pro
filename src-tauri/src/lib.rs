use chrono::Utc;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    env,
    ffi::OsStr,
    fs,
    io::Read,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopEnvironment {
    platform: String,
    app_data_dir: String,
    frame_cache_dir: String,
    ffmpeg_path: Option<String>,
    ffprobe_path: Option<String>,
    hardware_accelerations: Vec<String>,
    hardware_acceleration_enabled: bool,
    local_processing_ready: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct VideoDescriptor {
    name: String,
    size: u64,
    last_modified: u64,
    file_type: String,
    desktop_path: String,
    duration: f64,
    width: u32,
    height: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DocumentDescriptor {
    name: String,
    size: u64,
    last_modified: u64,
    file_type: String,
    desktop_path: String,
    bytes: Vec<u8>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExtractFramesRequest {
    video_path: String,
    project_id: String,
    mode: Option<String>,
    interval: Option<f64>,
    start_time: Option<f64>,
    end_time: Option<f64>,
    max_frames: Option<usize>,
    scene_threshold: Option<f64>,
    preview_width: Option<u32>,
    prefer_hardware: Option<bool>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FrameDescriptor {
    path: String,
    time: f64,
    width: u32,
    height: u32,
    size: u64,
}

struct TimedProcessOutput {
    success: bool,
    timed_out: bool,
    stderr: Vec<u8>,
}

fn background_command<S: AsRef<OsStr>>(program: S) -> Command {
    let command = Command::new(program);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        let mut command = command;
        command.creation_flags(CREATE_NO_WINDOW);
        command
    }
    #[cfg(not(target_os = "windows"))]
    {
        command
    }
}

fn run_command_with_timeout(
    mut command: Command,
    timeout: Duration,
) -> Result<TimedProcessOutput, String> {
    command.stdout(Stdio::null()).stderr(Stdio::piped());
    let mut child = command
        .spawn()
        .map_err(|error| format!("无法启动 FFmpeg：{error}"))?;
    let mut stderr = child.stderr.take().ok_or("无法读取 FFmpeg 运行日志")?;
    let stderr_reader = thread::spawn(move || {
        let mut output = Vec::new();
        let _ = stderr.read_to_end(&mut output);
        output
    });
    let started = Instant::now();

    loop {
        match child
            .try_wait()
            .map_err(|error| format!("无法读取 FFmpeg 状态：{error}"))?
        {
            Some(status) => {
                let stderr = stderr_reader.join().unwrap_or_default();
                return Ok(TimedProcessOutput {
                    success: status.success(),
                    timed_out: false,
                    stderr,
                });
            }
            None if started.elapsed() >= timeout => {
                let _ = child.kill();
                let _ = child.wait();
                let stderr = stderr_reader.join().unwrap_or_default();
                return Ok(TimedProcessOutput {
                    success: false,
                    timed_out: true,
                    stderr,
                });
            }
            None => thread::sleep(Duration::from_millis(200)),
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceMeta {
    history_id: String,
    history_name: String,
    saved_at: i64,
    project_count: usize,
    document_count: usize,
    asset_count: usize,
    project_names: Vec<String>,
}

fn app_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_local_data_dir()
        .map_err(|error| format!("无法定位本地数据目录：{error}"))
}

fn database_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app_data_dir(app)?;
    fs::create_dir_all(&dir).map_err(|error| format!("无法创建本地数据目录：{error}"))?;
    Ok(dir.join("workspace.sqlite3"))
}

fn open_database(app: &AppHandle) -> Result<Connection, String> {
    let path = database_path(app)?;
    let connection =
        Connection::open(path).map_err(|error| format!("无法打开本地项目数据库：{error}"))?;
    connection
        .execute_batch(
            "
            PRAGMA journal_mode = WAL;
            PRAGMA synchronous = NORMAL;
            CREATE TABLE IF NOT EXISTS workspace_history (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                saved_at INTEGER NOT NULL,
                payload TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS workspace_history_saved_at
            ON workspace_history(saved_at DESC);
            ",
        )
        .map_err(|error| format!("无法初始化本地项目数据库：{error}"))?;
    Ok(connection)
}

fn executable_name(tool: &str) -> String {
    if cfg!(target_os = "windows") {
        format!("{tool}.exe")
    } else {
        tool.to_string()
    }
}

fn tool_works(path: &Path) -> bool {
    background_command(path)
        .arg("-version")
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

fn find_tool(app: &AppHandle, tool: &str) -> Option<PathBuf> {
    let env_key = format!("VFP_{}_PATH", tool.to_ascii_uppercase());
    if let Ok(value) = env::var(env_key) {
        let path = PathBuf::from(value);
        if tool_works(&path) {
            return Some(path);
        }
    }

    let name = executable_name(tool);
    let mut candidates = Vec::new();
    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join("tools").join(&name));
        candidates.push(resource_dir.join(&name));
    }
    if let Ok(current_exe) = env::current_exe() {
        if let Some(parent) = current_exe.parent() {
            candidates.push(parent.join(&name));
        }
    }
    if let Some(home) = env::var_os("HOME").map(PathBuf::from) {
        candidates.push(home.join(".local").join("bin").join(&name));
    }
    candidates.push(PathBuf::from("/opt/homebrew/bin").join(&name));
    candidates.push(PathBuf::from("/usr/local/bin").join(&name));
    candidates.push(PathBuf::from(&name));

    candidates.into_iter().find(|path| tool_works(path))
}

fn detect_hardware_accelerations(ffmpeg: &Path) -> Vec<String> {
    let Ok(output) = background_command(ffmpeg)
        .args(["-hide_banner", "-hwaccels"])
        .output()
    else {
        return Vec::new();
    };
    if !output.status.success() {
        return Vec::new();
    }
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::trim)
        .filter(|line| {
            !line.is_empty()
                && !line.starts_with("Hardware acceleration")
                && line
                    .chars()
                    .all(|ch| ch.is_ascii_alphanumeric() || ch == '_')
        })
        .map(str::to_string)
        .collect()
}

fn probe_video(ffprobe: &Path, path: &Path) -> Result<(f64, u32, u32), String> {
    let output = background_command(ffprobe)
        .args([
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=width,height:format=duration",
            "-of",
            "json",
        ])
        .arg(path)
        .output()
        .map_err(|error| format!("无法读取视频信息：{error}"))?;
    if !output.status.success() {
        let detail = String::from_utf8_lossy(&output.stderr);
        return Err(format!("FFprobe 读取失败：{}", detail.trim()));
    }
    let value: Value = serde_json::from_slice(&output.stdout)
        .map_err(|error| format!("视频信息格式错误：{error}"))?;
    let stream = value
        .get("streams")
        .and_then(Value::as_array)
        .and_then(|items| items.first())
        .cloned()
        .unwrap_or_else(|| json!({}));
    let duration = value
        .pointer("/format/duration")
        .and_then(Value::as_str)
        .and_then(|item| item.parse::<f64>().ok())
        .unwrap_or(0.0);
    let width = stream.get("width").and_then(Value::as_u64).unwrap_or(0) as u32;
    let height = stream.get("height").and_then(Value::as_u64).unwrap_or(0) as u32;
    Ok((duration, width, height))
}

fn mime_for_path(path: &Path) -> String {
    match path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "mov" => "video/quicktime",
        "webm" => "video/webm",
        "mkv" => "video/x-matroska",
        "avi" => "video/x-msvideo",
        "m4v" => "video/x-m4v",
        _ => "video/mp4",
    }
    .to_string()
}

fn document_mime_for_path(path: &Path) -> String {
    match path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "doc" => "application/msword",
        "rtf" => "application/rtf",
        "json" => "application/json",
        "csv" => "text/csv",
        "md" => "text/markdown",
        _ => "text/plain",
    }
    .to_string()
}

fn safe_project_id(value: &str) -> String {
    let safe: String = value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '_'
            }
        })
        .take(96)
        .collect();
    if safe.is_empty() {
        format!("project-{}", Utc::now().timestamp_millis())
    } else {
        safe
    }
}

fn parse_scene_times(stderr: &str) -> Vec<f64> {
    stderr
        .split_whitespace()
        .filter_map(|part| part.strip_prefix("pts_time:"))
        .filter_map(|value| value.parse::<f64>().ok())
        .collect()
}

fn scaled_dimensions(source_width: u32, source_height: u32, limit: u32) -> (u32, u32) {
    if source_width == 0 || source_height == 0 {
        return (limit, ((limit as f64) * 9.0 / 16.0).round() as u32);
    }
    let width = source_width.min(limit).max(2);
    let mut height =
        ((source_height as f64) * (width as f64) / (source_width as f64)).round() as u32;
    if height % 2 != 0 {
        height += 1;
    }
    (width, height.max(2))
}

fn workspace_meta(payload: &Value) -> WorkspaceMeta {
    let projects = payload
        .get("projects")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let documents = payload
        .get("documents")
        .and_then(Value::as_array)
        .map(Vec::len)
        .unwrap_or(0);
    let asset_count = projects
        .iter()
        .map(|project| {
            project
                .get("batches")
                .and_then(Value::as_array)
                .map(|batches| {
                    batches
                        .iter()
                        .filter(|batch| {
                            matches!(
                                batch.get("assetKind").and_then(Value::as_str),
                                Some("cover" | "detail")
                            )
                        })
                        .count()
                })
                .unwrap_or(0)
        })
        .sum();
    let project_names = projects
        .iter()
        .take(3)
        .map(|project| {
            project
                .get("name")
                .or_else(|| project.get("fileName"))
                .and_then(Value::as_str)
                .unwrap_or("未命名视频")
                .to_string()
        })
        .collect();
    WorkspaceMeta {
        history_id: payload
            .get("historyId")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        history_name: payload
            .get("historyName")
            .and_then(Value::as_str)
            .unwrap_or("批量任务")
            .to_string(),
        saved_at: payload
            .get("savedAt")
            .and_then(Value::as_i64)
            .unwrap_or_else(|| Utc::now().timestamp_millis()),
        project_count: projects.len(),
        document_count: documents,
        asset_count,
        project_names,
    }
}

#[tauri::command]
fn get_desktop_environment(app: AppHandle) -> Result<DesktopEnvironment, String> {
    let data_dir = app_data_dir(&app)?;
    let cache_dir = data_dir.join("frame-cache");
    fs::create_dir_all(&cache_dir).map_err(|error| format!("无法创建本地帧缓存目录：{error}"))?;
    let ffmpeg = find_tool(&app, "ffmpeg");
    let ffprobe = find_tool(&app, "ffprobe");
    let hardware_accelerations = ffmpeg
        .as_deref()
        .map(detect_hardware_accelerations)
        .unwrap_or_default();
    Ok(DesktopEnvironment {
        platform: env::consts::OS.to_string(),
        app_data_dir: data_dir.to_string_lossy().into_owned(),
        frame_cache_dir: cache_dir.to_string_lossy().into_owned(),
        ffmpeg_path: ffmpeg
            .as_ref()
            .map(|path| path.to_string_lossy().into_owned()),
        ffprobe_path: ffprobe
            .as_ref()
            .map(|path| path.to_string_lossy().into_owned()),
        hardware_acceleration_enabled: cfg!(target_os = "windows")
            && !hardware_accelerations.is_empty(),
        hardware_accelerations,
        local_processing_ready: ffmpeg.is_some() && ffprobe.is_some(),
    })
}

#[tauri::command]
fn inspect_video_files(app: AppHandle, paths: Vec<String>) -> Result<Vec<VideoDescriptor>, String> {
    let ffprobe = find_tool(&app, "ffprobe")
        .ok_or("未找到 FFprobe，请安装 FFmpeg 或配置 VFP_FFPROBE_PATH")?;
    paths
        .into_iter()
        .map(|value| {
            let path = PathBuf::from(&value);
            if !path.is_file() {
                return Err(format!("视频文件不存在：{value}"));
            }
            app.asset_protocol_scope()
                .allow_file(&path)
                .map_err(|error| format!("无法授权视频预览：{error}"))?;
            let metadata =
                fs::metadata(&path).map_err(|error| format!("无法读取视频文件：{error}"))?;
            let modified = metadata
                .modified()
                .ok()
                .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
                .map(|duration| duration.as_millis() as u64)
                .unwrap_or(0);
            let (duration, width, height) = probe_video(&ffprobe, &path)?;
            Ok(VideoDescriptor {
                name: path
                    .file_name()
                    .and_then(|item| item.to_str())
                    .unwrap_or("未命名视频")
                    .to_string(),
                size: metadata.len(),
                last_modified: modified,
                file_type: mime_for_path(&path),
                desktop_path: path.to_string_lossy().into_owned(),
                duration,
                width,
                height,
            })
        })
        .collect()
}

#[tauri::command]
fn authorize_file_paths(app: AppHandle, paths: Vec<String>) -> Result<(), String> {
    let scope = app.asset_protocol_scope();
    for value in paths {
        let path = PathBuf::from(value);
        if path.is_file() {
            scope
                .allow_file(path)
                .map_err(|error| format!("无法授权本地文件：{error}"))?;
        }
    }
    Ok(())
}

#[tauri::command]
fn read_document_files(paths: Vec<String>) -> Result<Vec<DocumentDescriptor>, String> {
    paths
        .into_iter()
        .map(|value| {
            let path = PathBuf::from(&value);
            if !path.is_file() {
                return Err(format!("文档文件不存在：{value}"));
            }
            let metadata =
                fs::metadata(&path).map_err(|error| format!("无法读取文档信息：{error}"))?;
            if metadata.len() > 32 * 1024 * 1024 {
                return Err(format!(
                    "文档超过 32 MB，请精简后重新导入：{}",
                    path.file_name()
                        .and_then(|item| item.to_str())
                        .unwrap_or("未命名文档")
                ));
            }
            let modified = metadata
                .modified()
                .ok()
                .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
                .map(|duration| duration.as_millis() as u64)
                .unwrap_or(0);
            let bytes = fs::read(&path).map_err(|error| format!("无法读取文档：{error}"))?;
            Ok(DocumentDescriptor {
                name: path
                    .file_name()
                    .and_then(|item| item.to_str())
                    .unwrap_or("未命名文档")
                    .to_string(),
                size: metadata.len(),
                last_modified: modified,
                file_type: document_mime_for_path(&path),
                desktop_path: path.to_string_lossy().into_owned(),
                bytes,
            })
        })
        .collect()
}

fn extract_video_frames_blocking(
    app: AppHandle,
    request: ExtractFramesRequest,
) -> Result<Vec<FrameDescriptor>, String> {
    let ffmpeg =
        find_tool(&app, "ffmpeg").ok_or("未找到 FFmpeg，请安装 FFmpeg 或配置 VFP_FFMPEG_PATH")?;
    let ffprobe = find_tool(&app, "ffprobe")
        .ok_or("未找到 FFprobe，请安装 FFmpeg 或配置 VFP_FFPROBE_PATH")?;
    let video_path = PathBuf::from(&request.video_path);
    if !video_path.is_file() {
        return Err("原视频不存在或已经移动，请重新选择视频".to_string());
    }

    let (duration, source_width, source_height) = probe_video(&ffprobe, &video_path)?;
    let start_time = request.start_time.unwrap_or(0.0).max(0.0).min(duration);
    let end_time = request
        .end_time
        .unwrap_or(duration)
        .max(start_time)
        .min(duration);
    let max_frames = request.max_frames.unwrap_or(300).clamp(1, 600);
    let requested_interval = request.interval.unwrap_or(5.0).clamp(0.2, 3600.0);
    let width_limit = request.preview_width.unwrap_or(1920).clamp(640, 3840);
    let mode = request.mode.as_deref().unwrap_or("interval");
    let segment_duration = (end_time - start_time).max(1.0);
    let interval = if mode == "interval" {
        requested_interval.max(segment_duration / max_frames as f64)
    } else {
        requested_interval
    };

    let cache_dir = app_data_dir(&app)?
        .join("frame-cache")
        .join(safe_project_id(&request.project_id));
    if cache_dir.exists() {
        fs::remove_dir_all(&cache_dir).map_err(|error| format!("无法清理旧帧缓存：{error}"))?;
    }
    fs::create_dir_all(&cache_dir).map_err(|error| format!("无法创建帧缓存：{error}"))?;

    let scale = format!("scale=min({width_limit}\\,iw):-2:flags=lanczos");
    let filter = if mode == "scene" {
        let threshold = request.scene_threshold.unwrap_or(0.28).clamp(0.05, 0.8);
        format!("select=gt(scene\\,{threshold}),{scale},showinfo")
    } else {
        format!("fps=1/{interval:.6},{scale}")
    };
    let output_pattern = cache_dir.join("frame-%06d.jpg");
    let run_capture =
        |use_hardware: bool, timeout: Duration| -> Result<TimedProcessOutput, String> {
            let mut command = background_command(&ffmpeg);
            command.args(["-hide_banner", "-loglevel", "info"]);
            if use_hardware {
                command.args(["-hwaccel", "auto"]);
            }
            command
                .arg("-ss")
                .arg(format!("{start_time:.6}"))
                .arg("-i")
                .arg(&video_path);
            if end_time > start_time {
                command.args(["-t", &format!("{:.6}", end_time - start_time)]);
            }
            command
                .args(["-vf", &filter, "-frames:v"])
                .arg(max_frames.to_string())
                .args(["-q:v", "2", "-threads", "0"]);
            if mode == "scene" {
                command.args(["-fps_mode", "vfr"]);
            }
            command.arg("-y").arg(&output_pattern);
            run_command_with_timeout(command, timeout)
        };
    let prefer_hardware = cfg!(target_os = "windows") && request.prefer_hardware.unwrap_or(true);
    let hardware_timeout_secs =
        (45.0 + segment_duration * 0.16 + max_frames as f64 * 0.12).clamp(75.0, 150.0);
    let cpu_timeout_secs =
        (75.0 + segment_duration * 0.28 + max_frames as f64 * 0.18).clamp(120.0, 240.0);
    let mut output = run_capture(
        prefer_hardware,
        Duration::from_secs_f64(if prefer_hardware {
            hardware_timeout_secs
        } else {
            cpu_timeout_secs
        }),
    )?;
    if !output.success && prefer_hardware {
        if let Ok(entries) = fs::read_dir(&cache_dir) {
            for entry in entries.filter_map(Result::ok) {
                if entry.path().extension().and_then(|item| item.to_str()) == Some("jpg") {
                    let _ = fs::remove_file(entry.path());
                }
            }
        }
        output = run_capture(false, Duration::from_secs_f64(cpu_timeout_secs))?;
    }
    if !output.success {
        if output.timed_out {
            return Err(format!(
                "本地截帧超过 {} 分钟，已自动终止。请缩短截取范围、调大截取间隔或减少最多帧数后重试",
                (cpu_timeout_secs / 60.0).ceil() as u64
            ));
        }
        let detail = String::from_utf8_lossy(&output.stderr);
        let tail = detail.lines().rev().take(8).collect::<Vec<_>>();
        return Err(format!(
            "本地截帧失败：{}",
            tail.into_iter().rev().collect::<Vec<_>>().join(" ")
        ));
    }

    let mut files = fs::read_dir(&cache_dir)
        .map_err(|error| format!("无法读取帧缓存：{error}"))?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.extension().and_then(|item| item.to_str()) == Some("jpg"))
        .collect::<Vec<_>>();
    files.sort();
    if files.is_empty() {
        return Err(
            "FFmpeg 已结束但没有生成画面，请检查截取范围、视频编码或场景灵敏度".to_string(),
        );
    }
    let scene_times = if mode == "scene" {
        parse_scene_times(&String::from_utf8_lossy(&output.stderr))
    } else {
        Vec::new()
    };
    let (width, height) = scaled_dimensions(source_width, source_height, width_limit);
    let frame_count = files.len().max(1);
    let frames = files
        .into_iter()
        .enumerate()
        .map(|(index, path)| {
            let time = if mode == "scene" {
                scene_times
                    .get(index)
                    .copied()
                    .map(|value| start_time + value)
                    .unwrap_or_else(|| {
                        start_time + (end_time - start_time) * (index as f64) / (frame_count as f64)
                    })
            } else {
                (start_time + (index as f64) * interval).min(end_time)
            };
            let size = fs::metadata(&path).map(|item| item.len()).unwrap_or(0);
            FrameDescriptor {
                path: path.to_string_lossy().into_owned(),
                time,
                width,
                height,
                size,
            }
        })
        .collect::<Vec<_>>();
    fs::write(
        cache_dir.join("frames.json"),
        serde_json::to_vec_pretty(&frames).map_err(|error| format!("无法生成帧索引：{error}"))?,
    )
    .map_err(|error| format!("无法保存帧索引：{error}"))?;
    Ok(frames)
}

#[tauri::command]
async fn extract_video_frames(
    app: AppHandle,
    request: ExtractFramesRequest,
) -> Result<Vec<FrameDescriptor>, String> {
    tauri::async_runtime::spawn_blocking(move || extract_video_frames_blocking(app, request))
        .await
        .map_err(|error| format!("本地视频处理线程异常：{error}"))?
}

#[tauri::command]
fn clear_project_cache(app: AppHandle, project_id: String) -> Result<(), String> {
    let cache_dir = app_data_dir(&app)?
        .join("frame-cache")
        .join(safe_project_id(&project_id));
    if cache_dir.exists() {
        fs::remove_dir_all(cache_dir).map_err(|error| format!("无法清理帧缓存：{error}"))?;
    }
    Ok(())
}

#[tauri::command]
fn save_workspace(app: AppHandle, payload: Value) -> Result<WorkspaceMeta, String> {
    let meta = workspace_meta(&payload);
    if meta.history_id.is_empty() {
        return Err("历史记录缺少任务 ID".to_string());
    }
    let serialized =
        serde_json::to_string(&payload).map_err(|error| format!("无法序列化任务数据：{error}"))?;
    let connection = open_database(&app)?;
    connection
        .execute(
            "
            INSERT INTO workspace_history(id, name, saved_at, payload)
            VALUES (?1, ?2, ?3, ?4)
            ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                saved_at = excluded.saved_at,
                payload = excluded.payload
            ",
            params![
                meta.history_id,
                meta.history_name,
                meta.saved_at,
                serialized
            ],
        )
        .map_err(|error| format!("无法保存本地任务：{error}"))?;
    connection
        .execute(
            "
            DELETE FROM workspace_history
            WHERE id IN (
                SELECT id FROM workspace_history
                ORDER BY saved_at DESC
                LIMIT -1 OFFSET 20
            )
            ",
            [],
        )
        .map_err(|error| format!("无法整理历史记录：{error}"))?;
    Ok(meta)
}

#[tauri::command]
fn list_workspace_history(app: AppHandle) -> Result<Vec<WorkspaceMeta>, String> {
    let connection = open_database(&app)?;
    let mut statement = connection
        .prepare("SELECT payload FROM workspace_history ORDER BY saved_at DESC")
        .map_err(|error| format!("无法读取历史记录：{error}"))?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|error| format!("无法查询历史记录：{error}"))?;
    let mut records = Vec::new();
    for row in rows {
        let payload = row.map_err(|error| format!("无法读取历史记录：{error}"))?;
        let value: Value =
            serde_json::from_str(&payload).map_err(|error| format!("历史记录数据损坏：{error}"))?;
        records.push(workspace_meta(&value));
    }
    Ok(records)
}

#[tauri::command]
fn load_workspace(app: AppHandle, history_id: String) -> Result<Option<Value>, String> {
    let connection = open_database(&app)?;
    let mut statement = connection
        .prepare("SELECT payload FROM workspace_history WHERE id = ?1")
        .map_err(|error| format!("无法读取历史记录：{error}"))?;
    let mut rows = statement
        .query(params![history_id])
        .map_err(|error| format!("无法查询历史记录：{error}"))?;
    let Some(row) = rows
        .next()
        .map_err(|error| format!("无法读取历史记录：{error}"))?
    else {
        return Ok(None);
    };
    let payload: String = row
        .get(0)
        .map_err(|error| format!("无法读取历史记录：{error}"))?;
    let value =
        serde_json::from_str(&payload).map_err(|error| format!("历史记录数据损坏：{error}"))?;
    Ok(Some(value))
}

#[tauri::command]
fn rename_workspace(
    app: AppHandle,
    history_id: String,
    history_name: String,
) -> Result<(), String> {
    let connection = open_database(&app)?;
    let existing: String = connection
        .query_row(
            "SELECT payload FROM workspace_history WHERE id = ?1",
            params![history_id],
            |row| row.get(0),
        )
        .map_err(|error| format!("找不到历史记录：{error}"))?;
    let mut payload: Value =
        serde_json::from_str(&existing).map_err(|error| format!("历史记录数据损坏：{error}"))?;
    payload["historyName"] = Value::String(history_name.clone());
    let serialized =
        serde_json::to_string(&payload).map_err(|error| format!("无法保存任务名称：{error}"))?;
    connection
        .execute(
            "UPDATE workspace_history SET name = ?1, payload = ?2 WHERE id = ?3",
            params![history_name, serialized, history_id],
        )
        .map_err(|error| format!("无法重命名历史记录：{error}"))?;
    Ok(())
}

#[tauri::command]
fn delete_workspace(app: AppHandle, history_id: String) -> Result<(), String> {
    let connection = open_database(&app)?;
    connection
        .execute(
            "DELETE FROM workspace_history WHERE id = ?1",
            params![history_id],
        )
        .map_err(|error| format!("无法删除历史记录：{error}"))?;
    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let handle = app.handle().clone();
            open_database(&handle).map_err(std::io::Error::other)?;
            let cache_dir = app_data_dir(&handle)
                .map_err(std::io::Error::other)?
                .join("frame-cache");
            fs::create_dir_all(cache_dir)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_desktop_environment,
            inspect_video_files,
            authorize_file_paths,
            read_document_files,
            extract_video_frames,
            clear_project_cache,
            save_workspace,
            list_workspace_history,
            load_workspace,
            rename_workspace,
            delete_workspace
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Sales Kit Studio");
}
