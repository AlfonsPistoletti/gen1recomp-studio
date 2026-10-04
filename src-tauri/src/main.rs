// Desktop shell for Gen1Recomp Studio. The editor itself is the web front
// end; this only implements its Host interface (src/host/types.ts) as Tauri
// commands, plus a studio:// protocol that serves images.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod paths;

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use tauri::http::{Request, Response, StatusCode};
use tauri::{AppHandle, Manager, State, UriSchemeContext};

type CmdResult<T> = Result<T, String>;

#[derive(Default)]
struct Studio {
    install: Mutex<Option<paths::Install>>,
}

#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct Config {
    game_root: Option<String>,
}

#[derive(Serialize)]
struct VersionInfo {
    version: String,
    available: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HostInfo {
    game_root: String,
    kind: &'static str,
    mods_dir: String,
    portable: bool,
    modkit: bool,
    versions: Vec<VersionInfo>,
}

#[derive(Serialize)]
struct DirEntry {
    name: String,
    dir: bool,
}

#[derive(Serialize)]
struct ProcessResult {
    code: i32,
    output: String,
}

// ------------------------------------------------------------------ config

fn config_file(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("studio.config.json"))
}

fn read_config(app: &AppHandle) -> Config {
    config_file(app)
        .and_then(|f| fs::read_to_string(f).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

/// Resolution order: GEN1RECOMP_ROOT, the saved choice, a checkout next to
/// the studio. The front end asks the user to pick a folder when all fail.
fn discover(app: &AppHandle) -> Option<paths::Install> {
    let mut candidates = Vec::new();
    if let Some(env_root) = std::env::var_os("GEN1RECOMP_ROOT") {
        candidates.push(PathBuf::from(env_root));
    }
    if let Some(saved) = read_config(app).game_root {
        candidates.push(PathBuf::from(saved));
    }
    candidates.extend(paths::default_candidates());
    candidates.into_iter().find_map(|c| paths::detect(&c))
}

fn install(app: &AppHandle, state: &Studio) -> CmdResult<paths::Install> {
    let mut slot = state.install.lock().map_err(|e| e.to_string())?;
    if slot.is_none() {
        *slot = discover(app);
    }
    slot.clone()
        .ok_or_else(|| "gen1recomp not found. Choose your gen1recomp folder.".to_string())
}

// "game" is the folder holding mods/ (the repo, or a release's save
// directory); "cache:<version>" is that version's imported dataset.
fn root_dir(app: &AppHandle, state: &Studio, root: &str) -> CmdResult<PathBuf> {
    let inst = install(app, state)?;
    if root == "game" {
        return Ok(inst.mods_parent);
    }
    let version = root.strip_prefix("cache:").ok_or("bad root")?;
    inst.cache_root(version).ok_or_else(|| format!("no imported dataset for {version}"))
}

fn display(p: &Path) -> String {
    // canonicalize() on Windows yields \\?\C:\..., which reads badly
    p.to_string_lossy().trim_start_matches(r"\\?\").to_string()
}

// ------------------------------------------------------------------ commands

#[tauri::command]
fn host_info(app: AppHandle, state: State<Studio>) -> CmdResult<HostInfo> {
    let inst = install(&app, &state)?;
    let versions = paths::VERSIONS
        .iter()
        .map(|v| VersionInfo { version: v.to_string(), available: inst.cache_root(v).is_some() })
        .collect();
    Ok(HostInfo {
        game_root: display(&inst.root),
        kind: if inst.kind == paths::Kind::Source { "source" } else { "release" },
        mods_dir: display(&inst.mods_parent.join("mods")),
        portable: inst.portable,
        modkit: inst.has_modkit(),
        versions,
    })
}

#[tauri::command]
fn set_game_root(app: AppHandle, state: State<Studio>, path: String) -> CmdResult<HostInfo> {
    let Some(found) = paths::detect(&PathBuf::from(&path)) else {
        return Err(format!(
            "{path} is neither a gen1recomp checkout nor a gen1recomp release folder (no src/mods/Registry.lua, no gen1recomp executable)"
        ));
    };
    if let Some(file) = config_file(&app) {
        if let Some(parent) = file.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let config = Config { game_root: Some(path.clone()) };
        fs::write(&file, serde_json::to_string_pretty(&config).unwrap_or_default()).map_err(|e| e.to_string())?;
    }
    *state.install.lock().map_err(|e| e.to_string())? = Some(found);
    host_info(app, state)
}

#[tauri::command]
fn read_text(app: AppHandle, state: State<Studio>, root: String, path: String) -> CmdResult<Option<String>> {
    let full = paths::within(&root_dir(&app, &state, &root)?, &path)?;
    if !full.is_file() {
        return Ok(None);
    }
    fs::read_to_string(&full).map(Some).map_err(|e| format!("{}: {e}", display(&full)))
}

#[tauri::command]
fn write_text(app: AppHandle, state: State<Studio>, path: String, text: String) -> CmdResult<()> {
    // writes are confined to mods/
    if !path.starts_with("mods/") {
        return Err("writes are limited to mods/".into());
    }
    let full = paths::within(&install(&app, &state)?.mods_parent, &path)?;
    if let Some(parent) = full.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&full, text).map_err(|e| format!("{}: {e}", display(&full)))
}

// a path inside the mods folder, or an error: the only place writes may go
fn mods_file(app: &AppHandle, state: &Studio, path: &str) -> CmdResult<PathBuf> {
    if !path.starts_with("mods/") || path.len() <= "mods/".len() {
        return Err("writes are limited to mods/".into());
    }
    paths::within(&install(app, state)?.mods_parent, path)
}

#[tauri::command]
fn write_binary(app: AppHandle, state: State<Studio>, path: String, data: Vec<u8>) -> CmdResult<()> {
    let full = mods_file(&app, &state, &path)?;
    if let Some(parent) = full.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&full, data).map_err(|e| format!("{}: {e}", display(&full)))
}

#[tauri::command]
fn delete_file(app: AppHandle, state: State<Studio>, path: String) -> CmdResult<()> {
    let full = mods_file(&app, &state, &path)?;
    if full.is_file() {
        fs::remove_file(&full).map_err(|e| format!("{}: {e}", display(&full)))?;
    }
    Ok(())
}

#[tauri::command]
fn list_dir(app: AppHandle, state: State<Studio>, root: String, path: String) -> CmdResult<Vec<DirEntry>> {
    let full = paths::within(&root_dir(&app, &state, &root)?, &path)?;
    let Ok(entries) = fs::read_dir(&full) else { return Ok(vec![]) };
    Ok(entries
        .flatten()
        .map(|e| DirEntry {
            name: e.file_name().to_string_lossy().into_owned(),
            dir: e.file_type().map(|t| t.is_dir()).unwrap_or(false),
        })
        .collect())
}

#[tauri::command]
async fn modkit(app: AppHandle, args: Vec<String>) -> CmdResult<ProcessResult> {
    let inst = {
        let state = app.state::<Studio>();
        install(&app, &state)?
    };
    if !inst.has_modkit() {
        return Ok(ProcessResult {
            code: -1,
            output: "modkit needs a source checkout of gen1recomp (tools/modkit.py); release builds do not ship it.".into(),
        });
    }
    let root = inst.root;
    tauri::async_runtime::spawn_blocking(move || run_modkit(&root, &args))
        .await
        .map_err(|e| e.to_string())
}

fn run_modkit(root: &Path, args: &[String]) -> ProcessResult {
    let pythons: &[&str] = if cfg!(target_os = "windows") { &["py", "python"] } else { &["python3", "python"] };
    for python in pythons {
        let mut cmd = Command::new(python);
        cmd.arg("tools/modkit.py").args(args).current_dir(root).env("PYTHONIOENCODING", "utf-8");
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }
        if let Ok(out) = cmd.output() {
            let mut output = String::from_utf8_lossy(&out.stdout).into_owned();
            output.push_str(&String::from_utf8_lossy(&out.stderr));
            return ProcessResult { code: out.status.code().unwrap_or(-1), output };
        }
    }
    ProcessResult { code: -1, output: "Python not found on PATH (needed for tools/modkit.py).".into() }
}

// ------------------------------------------------------------------ images

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

// studio://localhost/image/<version>/<path>, resolved like LOVE's merged
// filesystem: the version's cache first, then the game root.
fn image_response(app: &AppHandle, request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    let not_found = || Response::builder().status(StatusCode::NOT_FOUND).body(Vec::new()).unwrap();
    let path = percent_decode(request.uri().path().trim_start_matches('/'));
    let Some(rest) = path.strip_prefix("image/") else { return not_found() };
    let Some((version, rel)) = rest.split_once('/') else { return not_found() };
    let state = app.state::<Studio>();
    let Ok(inst) = install(app, &state) else { return not_found() };
    let bases: Vec<PathBuf> = inst.cache_root(version).into_iter().chain([inst.mods_parent.clone()]).collect();
    for base in bases {
        let Ok(full) = paths::within(&base, rel) else { return not_found() };
        if let Ok(bytes) = fs::read(&full) {
            let mime = if rel.ends_with(".png") { "image/png" } else { "application/octet-stream" };
            return Response::builder()
                .header("Content-Type", mime)
                .header("Access-Control-Allow-Origin", "*")
                .body(bytes)
                .unwrap();
        }
    }
    not_found()
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(Studio::default())
        .register_uri_scheme_protocol("studio", |ctx: UriSchemeContext<'_, tauri::Wry>, request| {
            image_response(ctx.app_handle(), &request)
        })
        .invoke_handler(tauri::generate_handler![host_info, set_game_root, read_text, write_text, write_binary, delete_file, list_dir, modkit])
        .run(tauri::generate_context!())
        .expect("error while running Gen1Recomp Studio");
}
