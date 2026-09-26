#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use std::{
    fs, io::Write,
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
    time::{Duration, Instant},
};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{TrayIconBuilder, TrayIconEvent};
use tauri::{Manager, RunEvent, WebviewUrl, WebviewWindowBuilder, WindowEvent};

struct Backend {
    child: Mutex<Option<Child>>,
    closing: AtomicBool,
    port: Mutex<Option<u16>>,
}

fn normalize_path<P: AsRef<std::path::Path>>(path: P) -> std::path::PathBuf {
    #[cfg(windows)]
    {
        let s = path.as_ref().to_string_lossy();
        if let Some(stripped) = s.strip_prefix(r"\\?\UNC\") {
            return std::path::PathBuf::from(format!(r"\\{}", stripped));
        }
        if let Some(stripped) = s.strip_prefix(r"\\?\") {
            return std::path::PathBuf::from(stripped);
        }
    }
    path.as_ref().to_path_buf()
}

fn stop_backend(backend: &Backend) {
    backend.closing.store(true, Ordering::SeqCst);
    if let Ok(mut slot) = backend.child.lock() {
        if let Some(mut child) = slot.take() {
            if let Some(mut input) = child.stdin.take() {
                let _ = writeln!(input, "quit");
            }
            let deadline = Instant::now() + Duration::from_secs(5);
            loop {
                if matches!(child.try_wait(), Ok(Some(_))) {
                    break;
                }
                if Instant::now() >= deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    break;
                }
                std::thread::sleep(Duration::from_millis(50));
            }
        }
    }
}

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn hide_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
}

fn open_url(url: &str) {
    #[cfg(windows)]
    {
        let _ = Command::new("cmd").args(["/C", "start", "", url]).spawn();
    }
    #[cfg(not(windows))]
    {
        let _ = Command::new("xdg-open").arg(url).spawn();
    }
}

fn ensure_capsule(app: &tauri::AppHandle) {
    if app.get_webview_window("capsule").is_some() {
        return;
    }
    let _ = WebviewWindowBuilder::new(app, "capsule", WebviewUrl::App("capsule.html".into()))
        .title("EasyAG Capsule")
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .inner_size(340.0, 148.0)
        .focused(false)
        .visible(false)
        .build();
}

fn show_capsule(app: &tauri::AppHandle, kind: &str, title: &str, detail: &str) {
    ensure_capsule(app);
    let Some(window) = app.get_webview_window("capsule") else {
        return;
    };
    if let Ok(monitor) = window.primary_monitor().or_else(|_| window.current_monitor()) {
        if let Some(m) = monitor {
            let size = m.size();
            let scale = m.scale_factor();
            let w = 340.0 * scale;
            let h = 148.0 * scale;
            let x = (size.width as f64) - w - 18.0;
            let y = (size.height as f64) - h - 16.0;
            let _ = window.set_position(tauri::PhysicalPosition::new(x as i32, y as i32));
        }
    }
    let script = format!(
        "(function(){{ var t={}; var a={}; var d={}; function go(){{ if(window.__ea_capsule) window.__ea_capsule(t,a,d); }}; if(document.readyState==='complete') go(); else window.addEventListener('load',go); setTimeout(go,50); setTimeout(go,200); }})();",
        serde_json::to_string(kind).unwrap_or_else(|_| "\"danger\"".into()),
        serde_json::to_string(title).unwrap_or_default(),
        serde_json::to_string(detail).unwrap_or_default()
    );
    let _ = window.eval(&script);
    let _ = window.show();
    let _ = window.set_always_on_top(true);
}

fn hide_capsule(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("capsule") {
        let _ = window.hide();
    }
}

fn setup_tray(app: &tauri::App) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "打开控制面板", true, None::<&str>)?;
    let web = MenuItem::with_id(app, "web", "浏览器控制台", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出 EasyAntigravity", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[&show, &PredefinedMenuItem::separator(app)?, &web, &PredefinedMenuItem::separator(app)?, &quit],
    )?;

    let mut builder = TrayIconBuilder::with_id("easyag-tray")
        .tooltip("EasyAntigravity")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main_window(app),
            "web" => {
                let port = app.state::<Backend>().port.lock().ok().and_then(|p| *p);
                if let Some(port) = port {
                    open_url(&format!("http://127.0.0.1:{port}"));
                }
            }
            "quit" => {
                stop_backend(&app.state::<Backend>());
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::DoubleClick { .. } = event {
                show_main_window(tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon);
    }
    builder.build(app)?;
    Ok(())
}

fn start_backend(app: &tauri::AppHandle) -> Result<u16, Box<dyn std::error::Error>> {
    let exe_dir = normalize_path(std::env::current_exe()?.parent().ok_or("Missing executable directory")?);
    let resources = {
        let candidate = match app.path().resource_dir() {
            Ok(p) => normalize_path(p.join("backend")),
            Err(_) => exe_dir.join("backend"),
        };
        if candidate.join("server.js").exists() {
            candidate
        } else {
            exe_dir.join("backend")
        }
    };
    if !resources.join("server.js").exists() {
        return Err(format!("Missing backend server.js at {}", resources.display()).into());
    }
    let data = normalize_path(app.path().app_local_data_dir()?);
    fs::create_dir_all(&data)?;
    let ready = normalize_path(data.join(format!("ready-{}.json", std::process::id())));
    if ready.exists() {
        fs::remove_file(&ready)?;
    }
    let runtime = exe_dir.join(if cfg!(windows) { "easyag-node.exe" } else { "easyag-node" });
    if !runtime.exists() {
        return Err(format!("Missing Node runtime at {}", runtime.display()).into());
    }
    let log = fs::OpenOptions::new().create(true).append(true).open(data.join("backend-stderr.log"))?;
    let mut command = Command::new(&runtime);
    command
        .arg(resources.join("server.js"))
        .current_dir(&resources)
        .env("EASYAG_TAURI", "1")
        .env("EASYAG_NOCONSOLE", "1")
        .env("EASYAG_DATA_DIR", &data)
        .env("EASYAG_READY_FILE", &ready)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::from(log));
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let backend = app.state::<Backend>();
    {
        let mut slot = backend.child.lock().map_err(|_| "Backend lock poisoned")?;
        if backend.closing.load(Ordering::SeqCst) {
            return Err("Window closed".into());
        }
        let mut child = command.spawn()?;
        if let Some(stdout) = child.stdout.take() {
            let handle = app.clone();
            std::thread::spawn(move || {
                use std::io::{BufRead, BufReader};
                let reader = BufReader::new(stdout);
                for line in reader.lines() {
                    let Ok(line) = line else { continue };
                    let trimmed = line.trim();
                    if trimmed.is_empty() {
                        continue;
                    }
                    // JSON 协议：show_capsule / hide_capsule / exit
                    if trimmed.starts_with('{') {
                        if let Ok(v) = serde_json::from_str::<serde_json::Value>(trimmed) {
                            match v["cmd"].as_str().unwrap_or("") {
                                "show_capsule" => show_capsule(
                                    &handle,
                                    v["type"].as_str().unwrap_or("danger"),
                                    v["title"].as_str().unwrap_or(""),
                                    v["detail"].as_str().unwrap_or(""),
                                ),
                                "hide_capsule" => hide_capsule(&handle),
                                "exit" | "quit" => {
                                    stop_backend(&handle.state::<Backend>());
                                    handle.exit(0);
                                }
                                _ => {}
                            }
                        }
                        continue;
                    }
                    match trimmed {
                        "popup" | "focus" => show_main_window(&handle),
                        "hide" => hide_main_window(&handle),
                        "hide_capsule" => hide_capsule(&handle),
                        "quit" | "exit" => {
                            stop_backend(&handle.state::<Backend>());
                            handle.exit(0);
                        }
                        _ => {}
                    }
                }
            });
        }
        *slot = Some(child);
    }
    let deadline = Instant::now() + Duration::from_secs(20);
    loop {
        if backend.closing.load(Ordering::SeqCst) {
            return Err("Window closed".into());
        }
        if let Ok(contents) = fs::read_to_string(&ready) {
            if let Ok(value) = serde_json::from_str::<serde_json::Value>(&contents) {
                let port = value["port"]
                    .as_u64()
                    .filter(|p| *p > 0 && *p <= 65535)
                    .ok_or("Invalid backend port")? as u16;
                fs::remove_file(&ready)?;
                return Ok(port);
            }
        }
        {
            let mut slot = backend.child.lock().map_err(|_| "Backend lock poisoned")?;
            if let Some(child) = slot.as_mut() {
                if let Some(status) = child.try_wait()? {
                    return Err(format!(
                        "Backend exited ({status}); see {}",
                        data.join("backend-stderr.log").display()
                    )
                    .into());
                }
            }
        }
        if Instant::now() >= deadline {
            return Err("Backend readiness timed out; see backend-stderr.log".into());
        }
        std::thread::sleep(Duration::from_millis(100));
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            show_main_window(app);
        }))
        .manage(Backend {
            child: Mutex::new(None),
            closing: AtomicBool::new(false),
            port: Mutex::new(None),
        })
        .setup(|app| {
            let _ = setup_tray(app);
            ensure_capsule(app.handle());
            #[cfg(target_os = "macos")]
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_title("EasyAntigravity (macOS Beta)");
            }
            let handle = app.handle().clone();
            std::thread::spawn(move || match start_backend(&handle) {
                Ok(port) => {
                    if let Ok(mut slot) = handle.state::<Backend>().port.lock() {
                        *slot = Some(port);
                    }
                    if let Some(window) = handle.get_webview_window("main") {
                        let _ = window.navigate(format!("http://127.0.0.1:{port}").parse().unwrap());
                    }
                }
                Err(error) => {
                    stop_backend(&handle.state::<Backend>());
                    if let Some(window) = handle.get_webview_window("main") {
                        let message = format!("EasyAG 启动失败：{error}");
                        let _ = window.eval(&format!(
                            "document.body.textContent = {}",
                            serde_json::to_string(&message).unwrap()
                        ));
                    }
                }
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() != "main" {
                return;
            }
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .build(tauri::generate_context!())
        .expect("Failed to build EasyAG")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                stop_backend(&app.state::<Backend>());
            }
        });
}
