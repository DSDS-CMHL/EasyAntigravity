#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use std::{fs, io::Write, process::{Child, Command, Stdio}, sync::{Mutex, atomic::{AtomicBool, Ordering}}, time::{Duration, Instant}};
use tauri::{Manager, RunEvent, WindowEvent};

struct Backend { child: Mutex<Option<Child>>, closing: AtomicBool }
fn stop_backend(backend: &Backend) {
    backend.closing.store(true, Ordering::SeqCst);
    if let Ok(mut slot) = backend.child.lock() {
        if let Some(mut child) = slot.take() {
            if let Some(mut input) = child.stdin.take() { let _ = writeln!(input, "quit"); }
            let deadline = Instant::now() + Duration::from_secs(5);
            loop {
                if matches!(child.try_wait(), Ok(Some(_))) { break; }
                if Instant::now() >= deadline { let _ = child.kill(); let _ = child.wait(); break; }
                std::thread::sleep(Duration::from_millis(50));
            }
        }
    }
}
fn start_backend(app: &tauri::AppHandle) -> Result<u16, Box<dyn std::error::Error>> {
    let resources = app.path().resource_dir()?.join("backend");
    let data = app.path().app_local_data_dir()?;
    fs::create_dir_all(&data)?;
    let ready = data.join(format!("ready-{}.json", std::process::id()));
    if ready.exists() { fs::remove_file(&ready)?; }
    let runtime = std::env::current_exe()?.parent().ok_or("Missing executable directory")?
        .join(if cfg!(windows) { "easyag-node.exe" } else { "easyag-node" });
    let log = fs::OpenOptions::new().create(true).append(true).open(data.join("backend-stderr.log"))?;
    let mut command = Command::new(runtime);
    command.arg(resources.join("server.js")).current_dir(&resources)
        .env("EASYAG_TAURI", "1").env("EASYAG_NOCONSOLE", "1")
        .env("EASYAG_DATA_DIR", &data).env("EASYAG_READY_FILE", &ready)
        .stdin(Stdio::piped()).stdout(Stdio::null()).stderr(Stdio::from(log));
    #[cfg(windows)] {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let backend = app.state::<Backend>();
    {
        let mut slot = backend.child.lock().map_err(|_| "Backend lock poisoned")?;
        if backend.closing.load(Ordering::SeqCst) { return Err("Window closed".into()); }
        *slot = Some(command.spawn()?);
    }
    let deadline = Instant::now() + Duration::from_secs(20);
    loop {
        if backend.closing.load(Ordering::SeqCst) { return Err("Window closed".into()); }
        if let Ok(contents) = fs::read_to_string(&ready) {
            if let Ok(value) = serde_json::from_str::<serde_json::Value>(&contents) {
                let port = value["port"].as_u64().filter(|p| *p > 0 && *p <= 65535)
                    .ok_or("Invalid backend port")? as u16;
                fs::remove_file(&ready)?;
                return Ok(port);
            }
        }
        {
            let mut slot = backend.child.lock().map_err(|_| "Backend lock poisoned")?;
            if let Some(child) = slot.as_mut() {
                if let Some(status) = child.try_wait()? {
                    return Err(format!("Backend exited ({status}); see {}", data.join("backend-stderr.log").display()).into());
                }
            }
        }
        if Instant::now() >= deadline { return Err("Backend readiness timed out; see backend-stderr.log".into()); }
        std::thread::sleep(Duration::from_millis(100));
    }
}
fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize(); let _ = window.show(); let _ = window.set_focus();
            }
        }))
        .manage(Backend { child: Mutex::new(None), closing: AtomicBool::new(false) })
        .setup(|app| {
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                match start_backend(&handle) {
                    Ok(port) => if let Some(window) = handle.get_webview_window("main") {
                        let _ = window.navigate(format!("http://127.0.0.1:{port}").parse().unwrap());
                    },
                    Err(error) => {
                        stop_backend(&handle.state::<Backend>());
                        if let Some(window) = handle.get_webview_window("main") {
                            let message = format!("EasyAG 启动失败：{error}");
                            let _ = window.eval(&format!("document.body.textContent = {}", serde_json::to_string(&message).unwrap()));
                        }
                    }
                }
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { .. } = event {
                stop_backend(&window.app_handle().state::<Backend>());
                window.app_handle().exit(0);
            }
        })
        .build(tauri::generate_context!()).expect("Failed to build EasyAG")
        .run(|app, event| {
            if let RunEvent::Exit = event { stop_backend(&app.state::<Backend>()); }
        });
}
