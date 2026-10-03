#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::path::PathBuf;
use std::process::Command;
use std::time::{Duration, Instant};

use serde::Serialize;

/// core 服务监听地址与健康检查路径（与 packages/api-client、services/core 保持一致）。
const CORE_HOST: &str = "127.0.0.1";
const CORE_PORT: u16 = 4130;
const CORE_HEALTH_PATH: &str = "/api/health";

/// 单次端口探测超时。
const PROBE_TIMEOUT: Duration = Duration::from_secs(2);
/// `ensure_core` 拉起进程后，等待服务就绪的上限。
const START_TIMEOUT: Duration = Duration::from_secs(15);
/// 启动等待期间两次探测之间的间隔。
const POLL_INTERVAL: Duration = Duration::from_millis(250);

/// core 运行状态，序列化后形如 `{ "running": true, "url": "http://127.0.0.1:4130/api/health" }`。
#[derive(Debug, Clone, Serialize)]
pub struct CoreStatus {
    pub running: bool,
    pub url: String,
}

fn health_url() -> String {
    format!("http://{CORE_HOST}:{CORE_PORT}{CORE_HEALTH_PATH}")
}

/// 探测指定端口上是否运行着 core：建立 TCP 连接，发一次最小 HTTP/1.1 请求，校验状态码为 2xx。
///
/// 只做一次请求/一次读取，不引入 HTTP 客户端依赖。
fn probe_core_port(port: u16, timeout: Duration) -> bool {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let Ok(mut stream) = TcpStream::connect_timeout(&addr, timeout) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(timeout));
    let _ = stream.set_write_timeout(Some(timeout));

    let request = format!(
        "GET {CORE_HEALTH_PATH} HTTP/1.1\r\nHost: {CORE_HOST}:{port}\r\nConnection: close\r\n\r\n"
    );
    if stream.write_all(request.as_bytes()).is_err() {
        return false;
    }

    let mut buf = [0u8; 64];
    match stream.read(&mut buf) {
        Ok(n) if n > 0 => is_success_status(&buf[..n]),
        _ => false,
    }
}

/// 解析 TCP 收到的首行，判断是否为 2xx 状态。
fn is_success_status(bytes: &[u8]) -> bool {
    let head = String::from_utf8_lossy(bytes);
    let Some(status_line) = head.lines().next() else {
        return false;
    };
    let mut parts = status_line.split_whitespace();
    match (parts.next(), parts.next()) {
        (Some(version), Some(code)) => version.starts_with("HTTP/") && code.starts_with('2'),
        _ => false,
    }
}

/// 读取环境变量，空字符串视为未设置。
fn env_non_empty(key: &str) -> Option<String> {
    std::env::var(key)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

/// core 入口脚本的默认路径：`<仓库>/services/core/src/main.ts`。
///
/// `CARGO_MANIFEST_DIR` 指向 `<仓库>/apps/desktop/src-tauri`，向上三级即仓库根。
fn default_core_entry() -> Result<PathBuf, String> {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let entry = manifest_dir
        .join("..")
        .join("..")
        .join("..")
        .join("services")
        .join("core")
        .join("src")
        .join("main.ts");
    let entry = entry.canonicalize().unwrap_or(entry);
    if entry.is_file() {
        Ok(entry)
    } else {
        Err(format!(
            "找不到 core 入口 {}，请用 PAPERWITHA_CORE_ARGS 指定",
            entry.display()
        ))
    }
}

/// 解析启动命令：程序名来自 `PAPERWITHA_CORE_CMD`（默认 `bun`），
/// 参数来自 `PAPERWITHA_CORE_ARGS`（空格分隔，默认 `run <仓库>/services/core/src/main.ts`）。
fn core_command() -> Result<(String, Vec<String>), String> {
    let program = env_non_empty("PAPERWITHA_CORE_CMD").unwrap_or_else(|| "bun".to_string());
    let args = match env_non_empty("PAPERWITHA_CORE_ARGS") {
        Some(raw) => raw.split_whitespace().map(str::to_string).collect(),
        None => vec![
            "run".to_string(),
            default_core_entry()?.to_string_lossy().into_owned(),
        ],
    };
    Ok((program, args))
}

fn spawn_core(program: &str, args: &[String]) -> Result<(), String> {
    Command::new(program)
        .args(args)
        .spawn()
        .map(|_| ())
        .map_err(|err| format!("无法启动 core（{program} {}）: {err}", args.join(" ")))
}

/// 确认 core 在运行；不在则拉起，然后最多等待 [`START_TIMEOUT`]。
fn ensure_core_running() -> Result<CoreStatus, String> {
    let url = health_url();
    if probe_core_port(CORE_PORT, PROBE_TIMEOUT) {
        return Ok(CoreStatus { running: true, url });
    }

    let (program, args) = core_command()?;
    spawn_core(&program, &args)?;

    let deadline = Instant::now() + START_TIMEOUT;
    while Instant::now() < deadline {
        if probe_core_port(CORE_PORT, PROBE_TIMEOUT) {
            return Ok(CoreStatus { running: true, url });
        }
        std::thread::sleep(POLL_INTERVAL);
    }

    Err(format!(
        "core 在 {} 秒内未就绪（{url}）",
        START_TIMEOUT.as_secs()
    ))
}

/// 探测 core 是否已在运行（不启动进程）。
#[tauri::command]
fn core_status() -> CoreStatus {
    CoreStatus {
        running: probe_core_port(CORE_PORT, PROBE_TIMEOUT),
        url: health_url(),
    }
}

/// 确认 core 在运行；不在则拉起并等待就绪。
#[tauri::command]
fn ensure_core() -> Result<CoreStatus, String> {
    ensure_core_running()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|_app| {
            // 失败只记日志，窗口照常打开；前端可以再调用 core_status/ensure_core。
            match ensure_core_running() {
                Ok(status) => println!("[desktop] core 就绪：{}", status.url),
                Err(err) => eprintln!("[desktop] core 未就绪（窗口仍会打开）：{err}"),
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![core_status, ensure_core])
        .run(tauri::generate_context!())
        .expect("error while running PaperWithA");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;
    use std::thread;

    /// 起一个一次性 HTTP 服务，返回其端口；收到请求后回固定响应。
    fn spawn_stub_server(response: &'static [u8]) -> u16 {
        let listener = TcpListener::bind(("127.0.0.1", 0)).expect("bind stub server");
        let port = listener.local_addr().expect("local addr").port();
        thread::spawn(move || {
            if let Ok((mut stream, _)) = listener.accept() {
                let mut buf = [0u8; 256];
                let _ = stream.read(&mut buf);
                let _ = stream.write_all(response);
            }
        });
        port
    }

    #[test]
    fn probe_reports_running_core() {
        let port = spawn_stub_server(
            b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}",
        );
        assert!(probe_core_port(port, Duration::from_secs(2)));
    }

    #[test]
    fn probe_rejects_non_success_response() {
        let port = spawn_stub_server(
            b"HTTP/1.1 500 Internal Server Error\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
        );
        assert!(!probe_core_port(port, Duration::from_secs(2)));
    }

    #[test]
    fn probe_reports_missing_core() {
        // 绑定后立即释放，该端口上应无监听者。
        let port = {
            let listener = TcpListener::bind(("127.0.0.1", 0)).expect("bind");
            listener.local_addr().expect("local addr").port()
        };
        assert!(!probe_core_port(port, Duration::from_millis(500)));
    }

    #[test]
    fn success_status_parsing() {
        assert!(is_success_status(b"HTTP/1.1 200 OK\r\n"));
        assert!(is_success_status(b"HTTP/1.0 204 No Content\r\n"));
        assert!(!is_success_status(b"HTTP/1.1 404 Not Found\r\n"));
        assert!(!is_success_status(b"garbage"));
        assert!(!is_success_status(b""));
    }

    #[test]
    fn default_core_entry_points_at_core_main() {
        let entry = default_core_entry().expect("core entry exists in repo");
        assert!(
            entry.ends_with("services/core/src/main.ts"),
            "got {}",
            entry.display()
        );
    }
}
