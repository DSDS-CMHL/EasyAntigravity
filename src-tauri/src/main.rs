// EasyAntigravity Tauri Shell
// 管理窗口和 server.js sidecar 进程

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::process::{Child, Command};
use std::sync::Mutex;
use std::path::PathBuf;
use tauri::{Manager, RunEvent, WindowEvent};

// 存储 sidecar 进程句柄
struct SidecarProcess(Mutex<Option<Child>>);

// 获取资源目录中的 server.js 路径
fn get_server_path(app: &tauri::AppHandle) -> PathBuf {
    let resource_dir = app.path().resource_dir()
        .expect("Failed to get resource dir");
    resource_dir.join("server.js")
}

// 获取 Node.js 可执行文件路径
fn get_node_path() -> String {
    // 优先从 PATH 查找 node
    if let Ok(output) = Command::new("where").args(["node"]).output() {
        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path.is_empty() {
                return path.lines().next().unwrap_or("node").to_string();
            }
        }
    }
    "node".to_string()
}

// 启动 server.js sidecar
fn start_server(app: &tauri::AppHandle) -> Result<Child, String> {
    let server_path = get_server_path(app);
    let node_path = get_node_path();

    if !server_path.exists() {
        return Err(format!("server.js not found at: {}", server_path.display()));
    }

    let resource_dir = app.path().resource_dir()
        .map_err(|e| format!("Failed to get resource dir: {}", e))?;

    let child = Command::new(&node_path)
        .arg(&server_path)
        .current_dir(&resource_dir)
        .env("EASYAG_NOCONSOLE", "1")
        .env("EASYAG_TAURI", "1")
        .spawn()
        .map_err(|e| format!("Failed to start server: {}", e))?;

    Ok(child)
}

// 停止 server.js sidecar
fn stop_server(sidecar: &SidecarProcess) {
    if let Ok(mut guard) = sidecar.0.lock() {
        if let Some(child) = guard.as_mut() {
            let _ = child.kill();
            let _ = child.wait();
        }
        *guard = None;
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(SidecarProcess(Mutex::new(None)))
        .setup(|app| {
            let handle = app.handle().clone();

            // 启动 server.js sidecar
            match start_server(&handle) {
                Ok(child) => {
                    let sidecar = app.state::<SidecarProcess>();
                    if let Ok(mut guard) = sidecar.0.lock() {
                        *guard = Some(child);
                    }

                    // 等待服务就绪
                    std::thread::sleep(std::time::Duration::from_millis(2000));

                    // 导航到本地服务
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.navigate("http://127.0.0.1:19823".parse().unwrap());
                    }

                    println!("[Tauri] Server started successfully");
                }
                Err(e) => {
                    eprintln!("[Tauri] Failed to start server: {}", e);
                    // 显示错误页面
                    if let Some(window) = app.get_webview_window("main") {
                        let error_html = format!(
                            r#"<!DOCTYPE html>
<html><head><style>
body {{ background: #121319; color: #f3f4f6; font-family: system-ui; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }}
.error {{ text-align: center; }}
h1 {{ color: #f43f5e; }}
p {{ color: #9ca3af; }}
</style></head>
<body><div class="error">
<h1>启动失败</h1>
<p>{}</p>
<p>请确保 Node.js 已安装并在 PATH 中</p>
</div></body></html>"#, e
                        );
                        let _ = window.evaluate_script(&format!("document.write({})", serde_json::to_string(&error_html).unwrap()));
                    }
                }
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { .. } = event {
                // 窗口关闭时停止 sidecar
                let app = window.app_handle();
                let sidecar = app.state::<SidecarProcess>();
                stop_server(&sidecar);
            }
        })
        .build(tauri::generate_context!())
        .expect("Failed to build Tauri app")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                // 应用退出时确保 sidecar 停止
                let sidecar = app.state::<SidecarProcess>();
                stop_server(&sidecar);
            }
        });
}
