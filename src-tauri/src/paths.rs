// Locating a gen1recomp install and its imported ROM datasets. Two kinds:
//
//   source   a checkout of the repo (src/mods/Registry.lua). Mods live in
//            <repo>/mods, datasets where tools/modkit.py imported_data_dir
//            looks, and tools/modkit.py is available.
//   release  a packaged (fused) build: a folder holding the gen1recomp
//            executable. LOVE keeps a fused game's save directory without
//            the LOVE/ level (%APPDATA%/pokemon-love2d on Windows); mods and
//            datasets live there, or next to the executable in portable mode
//            (portable.txt, src/core/SaveData.lua). Mods dropped next to a
//            non-portable executable are only "strays" the launcher copies
//            into the save directory once, so the studio edits the save
//            directory's copy, which is the one the game runs.
//
// Same rules as server/paths.ts, so the desktop app and the dev server agree.

use std::env;
use std::fs;
use std::path::{Component, Path, PathBuf};

pub const VERSIONS: [&str; 11] = [
    "red", "blue", "yellow", "gold", "silver", "crystal", "firered", "leafgreen", "emerald", "ruby",
    "sapphire",
];

const GEN1: [&str; 3] = ["red", "blue", "yellow"];

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Source,
    Release,
}

#[derive(Clone)]
pub struct Install {
    pub kind: Kind,
    pub root: PathBuf,
    /// The folder holding mods/ (the "game" root the front end addresses).
    pub mods_parent: PathBuf,
    pub portable: bool,
}

fn identity() -> String {
    env::var("POKEPORT_IDENTITY").unwrap_or_else(|_| "pokemon-love2d".into())
}

/// LOVE's per-user data folder: `<appdata>/LOVE/<identity>` for unfused
/// (`love .`) runs, `<appdata>/<identity>` for fused builds.
fn save_dir(fused: bool) -> Option<PathBuf> {
    let base = if cfg!(target_os = "windows") {
        PathBuf::from(env::var_os("APPDATA")?)
    } else {
        let home = PathBuf::from(env::var_os("HOME")?);
        if cfg!(target_os = "macos") {
            home.join("Library").join("Application Support")
        } else {
            env::var_os("XDG_DATA_HOME").map(PathBuf::from).unwrap_or_else(|| home.join(".local").join("share"))
        }
    };
    let love = if cfg!(any(target_os = "windows", target_os = "macos")) { "LOVE" } else { "love" };
    Some(if fused { base.join(identity()) } else { base.join(love).join(identity()) })
}

fn is_source(dir: &Path) -> bool {
    dir.join("src").join("mods").join("Registry.lua").is_file()
}

// gen1recomp.exe, gen1recomp (Linux), gen1recomp.app, gen1recomp*.AppImage
fn is_release(dir: &Path) -> bool {
    let Ok(entries) = fs::read_dir(dir) else { return false };
    entries.flatten().any(|e| {
        let name = e.file_name().to_string_lossy().to_lowercase();
        name.starts_with("gen1recomp")
            && (name.ends_with(".exe") || name.ends_with(".app") || name.ends_with(".appimage") || name == "gen1recomp")
    })
}

pub fn detect(dir: &Path) -> Option<Install> {
    let root = dir.to_path_buf();
    if is_source(dir) {
        return Some(Install { kind: Kind::Source, mods_parent: root.clone(), root, portable: false });
    }
    if is_release(dir) {
        let portable = dir.join("portable.txt").is_file();
        let mods_parent = if portable { root.clone() } else { save_dir(true)? };
        return Some(Install { kind: Kind::Release, root, mods_parent, portable });
    }
    None
}

// a finished import: the engine writes rom-cache.complete last
// (gen1recomp src/import/CacheContract.lua); keep in sync with server/paths.ts
fn dataset_ok(base: &Path) -> bool {
    base.join("data").join("generated").join("maps.lua").is_file() && base.join("rom-cache.complete").is_file()
}

impl Install {
    pub fn has_modkit(&self) -> bool {
        self.kind == Kind::Source && self.root.join("tools").join("modkit.py").is_file()
    }

    /// The directory holding data/generated and assets/generated for one ROM
    /// version, or None when that version has not been imported.
    pub fn cache_root(&self, version: &str) -> Option<PathBuf> {
        let pinned = env::var("POKEPORT_VERSION").unwrap_or_else(|_| "red".into()).to_lowercase();
        if let Some(explicit) = env::var_os("POKEPORT_DATA_DIR") {
            if version == pinned {
                let dir = PathBuf::from(explicit);
                let base = dir.parent()?.parent()?.to_path_buf();
                return if dataset_ok(&base) { Some(base) } else { None };
            }
        }
        let mut candidates = Vec::new();
        match self.kind {
            Kind::Source => {
                candidates.push(self.root.join(version));
                if let Some(user) = save_dir(false) {
                    candidates.push(user.join(version));
                }
                // the historical source-tree dataset is a Gen 1 dataset
                if GEN1.contains(&version) {
                    candidates.push(self.root.clone());
                }
            }
            Kind::Release => {
                if self.portable {
                    candidates.push(self.root.join(version));
                } else if let Some(user) = save_dir(true) {
                    candidates.push(user.join(version));
                }
            }
        }
        candidates.into_iter().find(|b| dataset_ok(b))
    }
}

/// `base` joined with a relative path that may not climb out of it.
pub fn within(base: &Path, rel: &str) -> Result<PathBuf, String> {
    let rel_path = Path::new(rel);
    for c in rel_path.components() {
        match c {
            Component::Normal(_) | Component::CurDir => {}
            _ => return Err(format!("path escapes its root: {rel}")),
        }
    }
    Ok(base.join(rel_path))
}

/// Places to look for a checkout when nothing is configured: next to the
/// studio repo (dev runs start in src-tauri/), or next to the executable.
pub fn default_candidates() -> Vec<PathBuf> {
    let mut out = Vec::new();
    if let Ok(cwd) = env::current_dir() {
        for up in cwd.ancestors().take(5) {
            out.push(up.join("gen1recomp"));
        }
    }
    if let Ok(exe) = env::current_exe() {
        for up in exe.ancestors().skip(1).take(5) {
            out.push(up.join("gen1recomp"));
        }
    }
    out
}
