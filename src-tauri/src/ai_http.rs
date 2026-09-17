use futures_util::future::{AbortHandle, Abortable};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    sync::{Mutex, OnceLock},
    time::{Duration, Instant},
};

const BASE: &str = "https://llm-api.mcisaas.com/v1/";
const MAX_BODY: usize = 8 * 1024 * 1024;
fn client_builder() -> reqwest::ClientBuilder {
    // Use the same TLS provider as the existing updater, with certificate checks enabled.
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::none())
}
type Requests = HashMap<String, (Instant, Option<AbortHandle>)>;
static REQUESTS: OnceLock<Mutex<Requests>> = OnceLock::new();
fn requests() -> &'static Mutex<Requests> {
    REQUESTS.get_or_init(|| Mutex::new(HashMap::new()))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiRequest {
    request_id: String,
    operation: String,
    api_key: String,
    body: Option<String>,
    timeout_ms: u64,
}
#[derive(Serialize)]
pub struct AiResponse {
    status: u16,
    body: String,
}

fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 128 && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
}
fn endpoint(operation: &str) -> Result<String, String> {
    match operation {
        "models" => Ok(format!("{BASE}models")),
        "chat" => Ok(format!("{BASE}chat/completions")),
        _ => Err("不支持的 AI 接口操作".into()),
    }
}
struct RequestGuard(String);
impl Drop for RequestGuard {
    fn drop(&mut self) {
        if let Ok(mut active) = requests().lock() {
            active.remove(&self.0);
        }
    }
}
fn register(id: &str) -> Result<(futures_util::future::AbortRegistration, RequestGuard), String> {
    if !valid_id(id) {
        return Err("请求编号无效".into());
    }
    let mut active = requests().lock().map_err(|_| "请求状态不可用")?;
    active.retain(|_, (at, handle)| handle.is_some() || at.elapsed() < Duration::from_secs(180));
    if let Some((_, handle)) = active.get(id) {
        if handle.is_none() {
            active.remove(id);
            return Err("请求已取消".into());
        }
        return Err("请求编号重复".into());
    }
    if active.len() >= 128 {
        return Err("请求过多，请稍后重试".into());
    }
    let (handle, registration) = AbortHandle::new_pair();
    active.insert(id.into(), (Instant::now(), Some(handle)));
    Ok((registration, RequestGuard(id.into())))
}
#[tauri::command]
pub fn cancel_ai_http_request(request_id: String) -> Result<(), String> {
    if !valid_id(&request_id) {
        return Err("请求编号无效".into());
    }
    let mut active = requests().lock().map_err(|_| "请求状态不可用")?;
    if let Some((_, Some(handle))) = active.get(&request_id) {
        handle.abort();
    } else if active.len() < 128 {
        active.insert(request_id, (Instant::now(), None));
    }
    Ok(())
}
fn network_error(error: reqwest::Error) -> String {
    // Never expose request headers, credentials or image content in diagnostics.
    if error.is_timeout() {
        "AI 请求超时，请检查网络、代理或模型服务后重试".into()
    } else if error.is_connect() {
        "无法连接 AI 服务，请检查网络、系统代理及证书设置；也可切换本地选图".into()
    } else {
        "AI 连接中断或响应读取失败，请稍后重试；也可切换本地选图".into()
    }
}
async fn send(
    client: reqwest::Client,
    url: &str,
    request: &AiRequest,
) -> Result<AiResponse, String> {
    let builder = if request.operation == "models" {
        client.get(url)
    } else {
        let body = request.body.as_deref().ok_or("缺少 AI 请求内容")?;
        if body.len() > MAX_BODY {
            return Err("AI 请求内容过大".into());
        }
        let value: serde_json::Value = serde_json::from_str(body).map_err(|_| "AI 请求格式无效")?;
        client.post(url).json(&value)
    };
    let mut response = builder
        .bearer_auth(request.api_key.trim())
        .timeout(Duration::from_millis(
            request.timeout_ms.clamp(100, 120_000),
        ))
        .send()
        .await
        .map_err(network_error)?;
    let status = response.status().as_u16();
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(network_error)? {
        if body.len() + chunk.len() > MAX_BODY {
            return Err("AI 响应内容过大".into());
        }
        body.extend_from_slice(&chunk);
    }
    Ok(AiResponse {
        status,
        body: String::from_utf8(body).map_err(|_| "AI 响应编码无效")?,
    })
}
#[tauri::command]
pub async fn ai_http_request(request: AiRequest) -> Result<AiResponse, String> {
    let (registration, _guard) = register(&request.request_id)?;
    let url = endpoint(&request.operation)?;
    if request.api_key.trim().is_empty() || request.api_key.len() > 8192 {
        return Err("请填写有效的 API Key".into());
    }
    let client = client_builder()
        .build()
        .map_err(|_| "无法初始化 AI 网络连接")?;
    Abortable::new(send(client, &url, &request), registration)
        .await
        .map_err(|_| "请求已取消")?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        io::{Read, Write},
        net::TcpListener,
        thread,
    };
    fn server(status: &str, delay: u64) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let status = status.to_string();
        thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(3)))
                .unwrap();
            let mut bytes = [0u8; 8192];
            let _ = stream.read(&mut bytes);
            thread::sleep(Duration::from_millis(delay));
            let _ = write!(
                stream,
                "HTTP/1.1 {status}\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{{}}"
            );
        });
        url
    }
    fn input(id: &str) -> AiRequest {
        AiRequest {
            request_id: id.into(),
            operation: "models".into(),
            api_key: "test-only".into(),
            body: None,
            timeout_ms: 2000,
        }
    }
    #[test]
    fn only_fixed_provider_endpoints_are_allowed() {
        assert_eq!(endpoint("chat").unwrap(), format!("{BASE}chat/completions"));
        assert!(endpoint("https://example.com").is_err());
    }
    #[test]
    fn early_cancellation_is_retained_and_cleaned() {
        cancel_ai_http_request("test-ai-early".into()).unwrap();
        assert!(register("test-ai-early").is_err());
        assert!(!requests().lock().unwrap().contains_key("test-ai-early"));
    }
    #[test]
    fn http_status_and_body_are_preserved_without_cors() {
        tauri::async_runtime::block_on(async {
            let result = send(
                client_builder().no_proxy().build().unwrap(),
                &server("401 Unauthorized", 0),
                &input("test-ai-status"),
            )
            .await
            .unwrap();
            assert_eq!(result.status, 401);
            assert_eq!(result.body, "{}");
        });
    }
    #[test]
    fn timeout_has_actionable_message() {
        tauri::async_runtime::block_on(async {
            let mut request = input("test-ai-timeout");
            request.timeout_ms = 100;
            let error = send(
                client_builder().no_proxy().build().unwrap(),
                &server("200 OK", 500),
                &request,
            )
            .await
            .err()
            .unwrap();
            assert!(error.contains("超时"));
            assert!(!error.contains("test-only"));
        });
    }
    #[test]
    fn running_request_can_be_cancelled_and_registry_is_released() {
        tauri::async_runtime::block_on(async {
            let (registration, guard) = register("test-ai-running").unwrap();
            let request = input("test-ai-running");
            let url = server("200 OK", 1500);
            thread::spawn(|| {
                thread::sleep(Duration::from_millis(100));
                cancel_ai_http_request("test-ai-running".into()).unwrap();
            });
            let start = Instant::now();
            assert!(Abortable::new(
                send(client_builder().no_proxy().build().unwrap(), &url, &request),
                registration
            )
            .await
            .is_err());
            assert!(start.elapsed() < Duration::from_secs(1));
            drop(guard);
            assert!(!requests().lock().unwrap().contains_key("test-ai-running"));
        });
    }
}
