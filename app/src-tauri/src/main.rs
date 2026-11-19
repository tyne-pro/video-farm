// Desktop app of the tyne.pro video farm.
//
// The app carries everything the farm needs: Node.js, ffmpeg/ffprobe and the generator with its packages.
// It keeps the user's data in the TyneFarm folder in the home folder (cache, work files, finished clips),
// runs the generator on 127.0.0.1:4747 and shows its state. The editing form itself is the cabinet page
// (cp.tyne.pro/tools/farm), which talks to the generator on this computer.
// The cabinet connects the app with a link tynefarm://connect?k=<personal key>.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
use std::collections::VecDeque;
use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, RunEvent};
use tauri_plugin_deep_link::DeepLinkExt;
use tauri_plugin_opener::OpenerExt;

const PORTAL_DEFAULT: &str = "https://cp.tyne.pro";

/// The cabinet address (FARM_PORTAL overrides it for testing)
fn portal() -> String {
    std::env::var("FARM_PORTAL").unwrap_or_else(|_| PORTAL_DEFAULT.to_string())
}
const PORT: u16 = 4747;
const MODEL: &str = "medium";
const LOG_LINES: usize = 400;

#[derive(Default)]
struct Inner {
    child: Option<Child>,
    log: VecDeque<String>,
    phase: String,
    starting: bool,
}

#[derive(Clone, Default)]
struct Farm(Arc<Mutex<Inner>>);

#[derive(Serialize)]
struct Status {
    phase: String,
    running: bool,
    connected: bool,
    me: serde_json::Value,
    data: String,
    version: String,
    log: Vec<String>,
}

/** GET to the local generator (plain HTTP/1.0 on 127.0.0.1), JSON body or Null */
fn local_get(path: &str) -> serde_json::Value {
    let addr: SocketAddr = ([127, 0, 0, 1], PORT).into();
    let Ok(mut stream) = TcpStream::connect_timeout(&addr, Duration::from_millis(400)) else { return serde_json::Value::Null };
    let _ = stream.set_read_timeout(Some(Duration::from_secs(20)));
    if stream.write_all(format!("GET {path} HTTP/1.0\r\nHost: 127.0.0.1\r\n\r\n").as_bytes()).is_err() { return serde_json::Value::Null; }
    let mut raw = String::new();
    if stream.read_to_string(&mut raw).is_err() { return serde_json::Value::Null; }
    raw.split_once("\r\n\r\n").and_then(|(_, body)| serde_json::from_str(body).ok()).unwrap_or(serde_json::Value::Null)
}

fn exe(name: &str) -> String {
    if cfg!(windows) { format!("{name}.exe") } else { name.to_string() }
}

/// Folder with the bundled programs (externalBin lands next to the app executable)
fn bin_dir() -> PathBuf {
    std::env::current_exe().ok().and_then(|p| p.parent().map(Path::to_path_buf)).unwrap_or_default()
}

/// TyneFarm in the home folder: the same place the script install uses
fn data_dir() -> PathBuf {
    let home = std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).map(PathBuf::from).unwrap_or_default();
    home.join("TyneFarm")
}

fn generator_dir(app: &AppHandle) -> PathBuf {
    app.path().resource_dir().unwrap_or_default().join("generator")
}

fn push(farm: &Farm, app: &AppHandle, line: String) {
    let line = line.trim_end().to_string();
    if line.is_empty() { return; }
    {
        let mut s = farm.0.lock().unwrap();
        s.log.push_back(line.clone());
        while s.log.len() > LOG_LINES { s.log.pop_front(); }
    }
    let _ = app.emit("farm-log", line);
}

fn set_phase(farm: &Farm, app: &AppHandle, phase: &str) {
    farm.0.lock().unwrap().phase = phase.to_string();
    let _ = app.emit("farm-phase", phase.to_string());
}

fn port_open() -> bool {
    let addr: SocketAddr = ([127, 0, 0, 1], PORT).into();
    TcpStream::connect_timeout(&addr, Duration::from_millis(300)).is_ok()
}

/// Node.js from the app, with the bundled ffmpeg first on PATH and the data folder for everything writable
fn node_command(app: &AppHandle, script: &Path, args: &[&str]) -> Command {
    let bin = bin_dir();
    let data = data_dir();
    let mut cmd = Command::new(bin.join(exe("node")));
    cmd.arg(script).args(args)
        .current_dir(&data)
        .env("FARM_DATA", &data)
        .env("FARM_PORTAL", portal())
        .env("FFMPEG_PATH", bin.join(exe("ffmpeg")))
        .env("FFPROBE_PATH", bin.join(exe("ffprobe")))
        .env("NODE_PATH", generator_dir(app).join("node_modules"))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let sep = if cfg!(windows) { ";" } else { ":" };
    let path = std::env::var("PATH").unwrap_or_default();
    // Claude Code and git usually live here; a GUI app on macOS does not get the shell PATH
    let extra = if cfg!(target_os = "macos") { format!("{sep}/opt/homebrew/bin{sep}/usr/local/bin") } else { String::new() };
    cmd.env("PATH", format!("{}{sep}{path}{extra}", bin.display()));
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // no console window
    }
    cmd
}

/** Technical output goes to a file for support, never to the window */
fn pipe_to_file<R: Read + Send + 'static>(reader: R) {
    thread::spawn(move || {
        let path = data_dir().join(".cache").join("errors.log");
        let _ = fs::create_dir_all(path.parent().unwrap());
        if let Ok(mut file) = fs::OpenOptions::new().create(true).append(true).open(path) {
            for line in BufReader::new(reader).lines().map_while(Result::ok) {
                let _ = writeln!(file, "{line}");
            }
        }
    });
}

fn pipe<R: Read + Send + 'static>(farm: Farm, app: AppHandle, reader: R) {
    thread::spawn(move || {
        for line in BufReader::new(reader).lines().map_while(Result::ok) {
            push(&farm, &app, line);
        }
    });
}

/// One-time download of the speech model and the render browser, then the generator itself
fn start(app: AppHandle, farm: Farm) {
    {
        let mut s = farm.0.lock().unwrap();
        if s.starting || s.child.is_some() { return; }
        s.starting = true;
    }
    thread::spawn(move || {
        let data = data_dir();
        let _ = fs::create_dir_all(&data);
        let _ = fs::write(data.join(".portal"), portal());
        // Folders the user puts own files into (stickers, music, fonts) and the finished clips
        for dir in ["Готово", "stickers", "music", "fonts"] { let _ = fs::create_dir_all(data.join(dir)); }
        let gen = generator_dir(&app);
        let marker = data.join(".cache").join(format!(".prepared-{MODEL}"));

        if port_open() {
            push(&farm, &app, "Генератор уже працює".into());
            set_phase(&farm, &app, "running");
            farm.0.lock().unwrap().starting = false;
            return;
        }

        if !marker.exists() {
            set_phase(&farm, &app, "preparing");
            push(&farm, &app, "Перший запуск: готуємо програму (один раз, ~1.7 ГБ, 5–15 хвилин)".into());
            match node_command(&app, &gen.join("scripts").join("prepare.mjs"), &[MODEL]).spawn() {
                Ok(mut child) => {
                    if let Some(out) = child.stdout.take() { pipe(farm.clone(), app.clone(), out); }
                    if let Some(err) = child.stderr.take() { pipe_to_file(err); }
                    let ok = child.wait().map(|s| s.success()).unwrap_or(false);
                    if ok {
                        let _ = fs::create_dir_all(marker.parent().unwrap());
                        let _ = fs::write(&marker, "ok");
                    } else {
                        push(&farm, &app, "Підготовку не завершено: решту програма докачає під час першого ролика".into());
                    }
                }
                Err(_) => push(&farm, &app, "Не вдалося почати підготовку. Натисніть «Перезапустити»".into()),
            }
        }

        set_phase(&farm, &app, "starting");
        match node_command(&app, &gen.join("server.mjs"), &[]).spawn() {
            Ok(mut child) => {
                if let Some(out) = child.stdout.take() { pipe(farm.clone(), app.clone(), out); }
                if let Some(err) = child.stderr.take() { pipe_to_file(err); }
                farm.0.lock().unwrap().child = Some(child);
                for _ in 0..60 {
                    if port_open() { break; }
                    thread::sleep(Duration::from_millis(250));
                }
                set_phase(&farm, &app, if port_open() { "running" } else { "error" });
            }
            Err(_) => {
                push(&farm, &app, "Генератор не запустився. Натисніть «Перезапустити»".into());
                set_phase(&farm, &app, "error");
            }
        }
        farm.0.lock().unwrap().starting = false;
        watch(app, farm);
    });
}

/// Notice when the generator exits by itself
fn watch(app: AppHandle, farm: Farm) {
    thread::spawn(move || loop {
        thread::sleep(Duration::from_secs(2));
        let mut s = farm.0.lock().unwrap();
        let Some(child) = s.child.as_mut() else { return };
        if let Ok(Some(code)) = child.try_wait() {
            s.child = None;
            drop(s);
            let _ = code;
            push(&farm, &app, "Генератор зупинився. Натисніть «Перезапустити»".into());
            set_phase(&farm, &app, "stopped");
            return;
        }
    });
}

fn stop(farm: &Farm) {
    if let Some(mut child) = farm.0.lock().unwrap().child.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
}

fn save_key(key: &str) -> Result<(), String> {
    let key: String = key.chars().filter(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_')).take(120).collect();
    if key.len() < 8 { return Err("bad key".into()); }
    let data = data_dir();
    fs::create_dir_all(&data).map_err(|e| e.to_string())?;
    fs::write(data.join(".portal-key"), key).map_err(|e| e.to_string())
}

/// tynefarm://connect?k=<key> from the cabinet page
fn handle_link(app: &AppHandle, url: &str) {
    let Some(query) = url.split_once('?').map(|(_, q)| q) else { return };
    let Some(key) = query.split('&').find_map(|p| p.strip_prefix("k=")) else { return };
    let farm = app.state::<Farm>().inner().clone();
    match save_key(key) {
        Ok(()) => {
            push(&farm, app, "Кабінет підключено".into());
            let _ = app.emit("farm-connected", true);
            stop(&farm);
            start(app.clone(), farm);
        }
        Err(_) => push(&farm, app, "Посилання підключення пошкоджене. Натисніть «Підключити кабінет» ще раз".into()),
    }
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

#[tauri::command]
fn farm_status(app: AppHandle, farm: tauri::State<Farm>) -> Status {
    let running = port_open();
    let status = if running { local_get("/api/status") } else { serde_json::Value::Null };
    let s = farm.0.lock().unwrap();
    let phase = if running { "running".to_string() } else { s.phase.clone() };
    // Generator lines (clips) after the app's own lines
    let mut log: Vec<String> = s.log.iter().cloned().collect();
    if let Some(lines) = status.get("log").and_then(|v| v.as_array()) {
        log = lines.iter().filter_map(|v| v.as_str().map(String::from)).collect();
        for own in s.log.iter() { if !log.contains(own) { log.insert(0, own.clone()); } }
    }
    Status {
        phase,
        running,
        connected: data_dir().join(".portal-key").exists(),
        me: status.get("me").cloned().unwrap_or(serde_json::Value::Null),
        data: data_dir().display().to_string(),
        version: app.package_info().version.to_string(),
        log,
    }
}

#[tauri::command]
fn farm_disconnect(app: AppHandle, farm: tauri::State<Farm>) {
    let _ = fs::remove_file(data_dir().join(".portal-key"));
    let farm = farm.inner().clone();
    push(&farm, &app, "Кабінет відключено".into());
    stop(&farm);
    start(app, farm);
}

#[tauri::command]
fn farm_restart(app: AppHandle, farm: tauri::State<Farm>) {
    let farm = farm.inner().clone();
    stop(&farm);
    start(app, farm);
}

#[tauri::command]
fn open_place(app: AppHandle, place: String) -> Result<(), String> {
    let data = data_dir();
    let target = match place.as_str() {
        "done" => data.join("Готово"),
        "music" => data.join("music"),
        "assets" => data.join("assets"),
        _ => data,
    };
    fs::create_dir_all(&target).map_err(|e| e.to_string())?;
    app.opener().open_path(target.display().to_string(), None::<&str>).map_err(|e| e.to_string())
}

#[tauri::command]
fn open_link(app: AppHandle, path: String) -> Result<(), String> {
    // Only our own pages and the code repository
    let base = portal();
    let url = if path.starts_with('/') { format!("{base}{path}") } else { path };
    if !(url.starts_with(&base) || url.starts_with("https://tyne.pro") || url.starts_with("https://github.com/tyne-pro/") || url.starts_with("https://claude.ai/")) {
        return Err("blocked".into());
    }
    app.opener().open_url(url, None::<&str>).map_err(|e| e.to_string())
}

fn main() {
    let farm = Farm::default();
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if let Some(url) = argv.iter().find(|a| a.starts_with("tynefarm://")) {
                handle_link(app, url);
            } else if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .manage(farm.clone())
        .invoke_handler(tauri::generate_handler![farm_status, farm_restart, farm_disconnect, open_place, open_link])
        .setup(move |app| {
            #[cfg(any(windows, target_os = "linux"))]
            {
                let _ = app.deep_link().register_all();
            }
            let handle = app.handle().clone();
            app.deep_link().on_open_url(move |event| {
                for url in event.urls() {
                    handle_link(&handle, url.as_str());
                }
            });
            if let Ok(Some(urls)) = app.deep_link().get_current() {
                for url in urls {
                    handle_link(app.handle(), url.as_str());
                }
            }
            start(app.handle().clone(), farm.clone());
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building the farm app");

    let farm = app.state::<Farm>().inner().clone();
    app.run(move |_app, event| {
        if let RunEvent::Exit = event {
            stop(&farm);
        }
    });
}
