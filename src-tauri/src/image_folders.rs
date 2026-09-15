use serde::Serialize;
use std::{
    fs,
    path::{Path, PathBuf},
};
use tauri::{AppHandle, Manager};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageSource {
    name: String,
    file_path: String,
    size: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageFolder {
    name: String,
    folder_path: String,
    images: Vec<ImageSource>,
    skipped: Vec<String>,
}

fn collect_images(root: &Path, cache: &Path) -> Result<ImageFolder, String> {
    let root = root
        .canonicalize()
        .map_err(|e| format!("无法打开图片文件夹：{e}"))?;
    if !root.is_dir() {
        return Err("请选择文件夹".into());
    }
    // Exclusive creation prevents overwriting a previous import or its history.
    fs::create_dir(cache).map_err(|e| format!("无法创建图片副本目录：{e}"))?;
    let cache = cache
        .canonicalize()
        .map_err(|e| format!("无法定位图片副本目录：{e}"))?;
    let result = (|| {
        let mut pending = vec![root.clone()];
        let mut files: Vec<PathBuf> = Vec::new();
        let mut skipped = Vec::new();
        while let Some(dir) = pending.pop() {
            for entry in
                fs::read_dir(&dir).map_err(|e| format!("无法读取文件夹 {}：{e}", dir.display()))?
            {
                let entry = entry.map_err(|e| format!("无法读取目录项：{e}"))?;
                let path = entry.path();
                let kind = entry.file_type().map_err(|e| e.to_string())?;
                // Never follow links outside the chosen tree or recurse into our own cache.
                if kind.is_symlink() || path == cache {
                    continue;
                }
                if kind.is_dir() {
                    pending.push(path);
                    continue;
                }
                let ext = path
                    .extension()
                    .and_then(|s| s.to_str())
                    .unwrap_or("")
                    .to_ascii_lowercase();
                if kind.is_file() && matches!(ext.as_str(), "jpg" | "jpeg" | "png" | "webp") {
                    files.push(path);
                }
            }
        }
        files.sort();
        let mut images = Vec::new();
        for path in files {
            let name = path
                .strip_prefix(&root)
                .unwrap()
                .to_string_lossy()
                .replace('\\', "/");
            let size = fs::metadata(&path).map_err(|e| e.to_string())?.len();
            if size == 0 || size > 24 * 1024 * 1024 {
                skipped.push(format!("{name}：空文件或超过 24 MB"));
                continue;
            }
            let ext = path
                .extension()
                .unwrap()
                .to_string_lossy()
                .to_ascii_lowercase();
            let dest = cache.join(format!("image-{:06}.{ext}", images.len()));
            fs::copy(&path, &dest).map_err(|e| format!("无法保存 {name} 的本地副本：{e}"))?;
            images.push(ImageSource {
                name,
                file_path: dest.to_string_lossy().into_owned(),
                size,
            });
        }
        if images.is_empty() {
            return Err("文件夹中没有可读取的 JPG、PNG 或 WebP 图片（单张不超过 24 MB）".into());
        }
        Ok(ImageFolder {
            name: root
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned(),
            folder_path: root.to_string_lossy().into_owned(),
            images,
            skipped,
        })
    })();
    if result.is_err() {
        let _ = fs::remove_dir_all(&cache);
    }
    result
}

#[tauri::command]
pub async fn import_image_folder(
    app: AppHandle,
    path: String,
    cache_id: String,
) -> Result<ImageFolder, String> {
    let cache = super::app_data_dir(&app)?
        .join("frame-cache")
        .join(super::safe_project_id(&cache_id));
    tauri::async_runtime::spawn_blocking(move || {
        let folder = collect_images(Path::new(&path), &cache)?;
        for image in &folder.images {
            app.asset_protocol_scope()
                .allow_file(&image.file_path)
                .map_err(|e| e.to_string())?;
        }
        Ok(folder)
    })
    .await
    .map_err(|e| format!("图片导入线程异常：{e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn folder_copies_supported_nested_files_without_changing_sources() {
        let temp = std::env::temp_dir().join(format!(
            "vfp-images-{}-{}",
            std::process::id(),
            chrono::Utc::now().timestamp_nanos_opt().unwrap()
        ));
        let source = temp.join("source");
        fs::create_dir_all(source.join("nested")).unwrap();
        fs::write(source.join("nested/a.PNG"), b"image-one").unwrap();
        fs::write(source.join("b.jpg"), b"image-two").unwrap();
        fs::write(source.join("empty.webp"), b"").unwrap();
        fs::write(source.join("secret.txt"), b"not-image").unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(&temp, source.join("loop")).unwrap();
        let cache = temp.join("cache");
        let folder = collect_images(&source, &cache).unwrap();
        assert_eq!(folder.images.len(), 2);
        assert_eq!(folder.skipped.len(), 1);
        assert!(folder.images.iter().any(|f| f.name == "nested/a.PNG"));
        assert!(collect_images(&source, &cache).is_err());
        fs::remove_dir_all(&source).unwrap();
        assert!(folder
            .images
            .iter()
            .all(|f| fs::read(&f.file_path).unwrap().starts_with(b"image-")));
        fs::remove_dir_all(temp).unwrap();
    }
}
