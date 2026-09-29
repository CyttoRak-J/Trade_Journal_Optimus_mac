// Trade Journal desktop shell.
//
// Starts the bundled Next.js server with the bundled Node runtime, shows it in
// a native window (system WebView2 / WKWebView), and stops the server when the
// window closes. Nothing keeps running after the app quits: the server is
// killed on exit, and boot.cjs also exits on its own if this process dies.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs::{self, File};
use std::net::{SocketAddr, TcpStream};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager, RunEvent, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_opener::OpenerExt;

const PORT: u16 = 3717;
const ORIGIN: &str = "http://127.0.0.1:3717";

struct Server(Mutex<Option<Child>>);

// Links that would open a new window (target=_blank, window.open) to another
// site are sent through navigation instead, where on_navigation hands them to
// the system browser.
const LINK_SCRIPT: &str = r#"
(() => {
  const external = (u) => { try { const x = new URL(u, location.href); return /^https?:$/.test(x.protocol) && x.origin !== location.origin; } catch { return false; } };
  document.addEventListener("click", (e) => {
    const a = e.target && e.target.closest && e.target.closest("a[href]");
    if (a && a.target === "_blank" && external(a.href)) { e.preventDefault(); location.href = a.href; }
  }, true);
  const open = window.open;
  window.open = function (u, ...rest) {
    if (u && external(u)) { location.href = new URL(u, location.href).href; return null; }
    return open.call(window, u, ...rest);
  };
})();
"#;

fn port_open() -> bool {
    let addr = SocketAddr::from(([127, 0, 0, 1], PORT));
    TcpStream::connect_timeout(&addr, Duration::from_millis(300)).is_ok()
}

fn start_server(app: &AppHandle) -> Result<Child, String> {
    let resources = dunce::simplified(&app.path().resource_dir().map_err(|e| e.to_string())?).join("resources");
    let data: PathBuf = dunce::simplified(&app.path().app_data_dir().map_err(|e| e.to_string())?).to_path_buf();
    fs::create_dir_all(&data).map_err(|e| e.to_string())?;

    let node = resources.join("runtime").join(if cfg!(windows) { "node.exe" } else { "node" });
    let log = File::create(data.join("server.log")).map_err(|e| e.to_string())?;
    let err_log = log.try_clone().map_err(|e| e.to_string())?;

    let mut cmd = Command::new(&node);
    cmd.arg(resources.join("boot.cjs"))
        .current_dir(resources.join("server").join("apps").join("web"))
        .env("NODE_ENV", "production")
        .env("PORT", PORT.to_string())
        .env("HOSTNAME", "127.0.0.1")
        .env("JOURNAL_DATA_DIR", &data)
        .stdin(Stdio::piped())
        .stdout(log)
        .stderr(err_log);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd.spawn().map_err(|e| format!("Could not start {}: {e}", node.display()))
}

fn show_error(win: &WebviewWindow, message: &str) {
    let _ = win.eval(format!("showError({})", serde_json::to_string(message).unwrap_or_default()));
}

fn boot(app: AppHandle, win: WebviewWindow) {
    // A just-closed previous session may still be releasing the port.
    let deadline = Instant::now() + Duration::from_secs(5);
    while port_open() && Instant::now() < deadline {
        thread::sleep(Duration::from_millis(200));
    }
    if port_open() {
        show_error(&win, &format!("Port {PORT} is already in use by another program.\nClose it and reopen Trade Journal."));
        return;
    }

    let child = match start_server(&app) {
        Ok(child) => child,
        Err(e) => return show_error(&win, &e),
    };
    let state = app.state::<Server>();
    *state.0.lock().unwrap() = Some(child);

    let deadline = Instant::now() + Duration::from_secs(90);
    loop {
        if port_open() {
            let _ = win.navigate(Url::parse(ORIGIN).unwrap());
            return;
        }
        let exited = state.0.lock().unwrap().as_mut().map_or(true, |c| matches!(c.try_wait(), Ok(Some(_))));
        if exited || Instant::now() > deadline {
            let log = app.path().app_data_dir().map(|d| d.join("server.log").display().to_string()).unwrap_or_default();
            return show_error(&win, &format!("The journal server failed to start.\nDetails: {log}"));
        }
        thread::sleep(Duration::from_millis(200));
    }
}

fn stop_server(app: &AppHandle) {
    if let Some(mut child) = app.state::<Server>().0.lock().unwrap().take() {
        drop(child.stdin.take());
        let _ = child.kill();
        let _ = child.wait();
    }
}

fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.unminimize();
                let _ = win.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .manage(Server(Mutex::new(None)))
        .setup(|app| {
            let handle = app.handle().clone();
            let nav = app.handle().clone();
            let win = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("Trade Journal")
                .inner_size(1400.0, 900.0)
                .min_inner_size(900.0, 600.0)
                .initialization_script(LINK_SCRIPT)
                .on_navigation(move |url| {
                    let internal = url.as_str().starts_with(ORIGIN)
                        || !matches!(url.scheme(), "http" | "https")
                        || url.host_str() == Some("tauri.localhost");
                    if !internal {
                        let _ = nav.opener().open_url(url.as_str(), None::<&str>);
                    }
                    internal
                })
                .build()?;
            thread::spawn(move || boot(handle, win));
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Trade Journal");

    app.run(|app, event| {
        if let RunEvent::Exit = event {
            stop_server(app);
        }
    });
}
