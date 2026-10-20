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
use tauri::{Manager, RunEvent, WindowEvent};

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
    #[cfg(target_os = "macos")]
    {
        let _ = Command::new("open").arg(url).spawn();
    }
    #[cfg(all(not(windows), not(target_os = "macos")))]
    {
        let _ = Command::new("xdg-open").arg(url).spawn();
    }
}

fn setup_tray(app: &tauri::App) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "显示窗口", true, None::<&str>)?;
    let web = MenuItem::with_id(app, "web", "浏览器控制台", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出应用", true, Some("Ctrl+Q"))?;
    let menu = Menu::with_items(
        app,
        &[&show, &web, &PredefinedMenuItem::separator(app)?, &quit],
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
                    if trimmed.starts_with('{') {
                        if let Ok(v) = serde_json::from_str::<serde_json::Value>(trimmed) {
                            match v["cmd"].as_str().unwrap_or("") {
                                "popup" | "focus" => show_main_window(&handle),
                                "hide_easyag" | "hide" => hide_main_window(&handle),
                                "theme" => {
                                    if let Some(window) = handle.get_webview_window("main") {
                                        let theme = match v["value"].as_str() {
                                            Some("light") => Some(tauri::Theme::Light),
                                            Some("dark") => Some(tauri::Theme::Dark),
                                            _ => None,
                                        };
                                        let _ = window.set_theme(theme);
                                    }
                                }
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
                        "hide" | "hide_easyag" => hide_main_window(&handle),
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
