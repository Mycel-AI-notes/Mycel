use crate::core::vault::read_kb_dirs;
use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

#[derive(Clone, Serialize)]
struct FileChangedPayload {
    path: String,
}

#[derive(Clone, Serialize)]
struct KbDirChangedPayload {
    /// Vault-relative path of the KB whose folder contents changed.
    path: String,
}

pub struct VaultWatcher {
    _watcher: RecommendedWatcher,
}

pub fn start_watcher(app: AppHandle, root: PathBuf) -> Option<VaultWatcher> {
    let (tx, rx) = mpsc::channel::<notify::Result<Event>>();

    let mut watcher: RecommendedWatcher = match RecommendedWatcher::new(
        move |res: notify::Result<Event>| {
            let _ = tx.send(res);
        },
        Config::default().with_poll_interval(Duration::from_secs(2)),
    ) {
        Ok(w) => w,
        Err(_) => return None,
    };

    if watcher.watch(&root, RecursiveMode::Recursive).is_err() {
        return None;
    }

    let root_clone = root.clone();
    // Debounce by path: collect events, only emit at most once per path per ~150ms.
    thread::spawn(move || {
        // Map of path -> last-emitted time (separate maps so a .db.json
        // event doesn't reset the throttle on a KB folder and vice versa).
        let recent_files: Mutex<HashMap<String, Instant>> = Mutex::new(HashMap::new());
        let recent_kbs: Mutex<HashMap<String, Instant>> = Mutex::new(HashMap::new());
        let file_debounce = Duration::from_millis(150);
        // A wider throttle for KB refreshes: a bulk filesystem op (e.g.
        // paste 100 files) generates a burst of events and one refresh
        // per second is plenty. The frontend listener also debounces
        // (SETTLE_MS in App.tsx) — total perceived latency is the sum.
        let kb_throttle = Duration::from_millis(750);

        while let Ok(res) = rx.recv() {
            let event = match res {
                Ok(e) => e,
                Err(_) => continue,
            };
            // Only modify / create / remove
            match event.kind {
                EventKind::Modify(_) | EventKind::Create(_) | EventKind::Remove(_) => {}
                _ => continue,
            }

            for path in event.paths {
                let rel = match path.strip_prefix(&root_clone) {
                    Ok(r) => r.to_string_lossy().replace('\\', "/"),
                    Err(_) => continue,
                };

                if is_db_file(&path) {
                    let now = Instant::now();
                    {
                        let mut guard = recent_files.lock().unwrap();
                        if let Some(prev) = guard.get(&rel) {
                            if now.duration_since(*prev) < file_debounce {
                                continue;
                            }
                        }
                        guard.insert(rel.clone(), now);
                    }
                    let _ = app.emit("vault:file-changed", FileChangedPayload { path: rel });
                    continue;
                }

                // Any change inside a registered KB folder — file or
                // subdirectory — means the file tree under that KB has
                // potentially diverged from the rows in its .db.json.
                // Tell the frontend so it can call kb_refresh.
                if let Some(kb_dir) = find_owning_kb(&root_clone, &rel) {
                    let now = Instant::now();
                    {
                        let mut guard = recent_kbs.lock().unwrap();
                        if let Some(prev) = guard.get(&kb_dir) {
                            if now.duration_since(*prev) < kb_throttle {
                                continue;
                            }
                        }
                        guard.insert(kb_dir.clone(), now);
                    }
                    let _ = app.emit(
                        "kb:dir-changed",
                        KbDirChangedPayload { path: kb_dir },
                    );
                }
            }
        }
    });

    Some(VaultWatcher { _watcher: watcher })
}

fn is_db_file(path: &Path) -> bool {
    path.file_name()
        .and_then(|n| n.to_str())
        .map(|n| n.ends_with(".db.json"))
        .unwrap_or(false)
}

/// If `rel` (vault-relative path) lies inside a registered KB folder,
/// return that folder's path. When KBs are nested, the deepest match
/// wins so the most specific KB owns the event.
fn find_owning_kb(root: &Path, rel: &str) -> Option<String> {
    let config = read_kb_dirs(root)?;
    config
        .dirs
        .into_iter()
        .map(|e| e.path)
        .filter(|p| {
            let trimmed = p.trim_matches('/');
            if trimmed.is_empty() {
                return false;
            }
            let prefix = format!("{trimmed}/");
            rel.starts_with(&prefix)
        })
        .max_by_key(|p| p.len())
}
