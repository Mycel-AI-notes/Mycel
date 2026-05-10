use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
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
        // Map of path -> last-emitted time
        let recent: Mutex<std::collections::HashMap<String, Instant>> =
            Mutex::new(std::collections::HashMap::new());
        let debounce = Duration::from_millis(150);

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
                if !is_db_file(&path) {
                    continue;
                }
                let rel = match path.strip_prefix(&root_clone) {
                    Ok(r) => r.to_string_lossy().replace('\\', "/"),
                    Err(_) => continue,
                };
                let now = Instant::now();
                {
                    let mut guard = recent.lock().unwrap();
                    if let Some(prev) = guard.get(&rel) {
                        if now.duration_since(*prev) < debounce {
                            continue;
                        }
                    }
                    guard.insert(rel.clone(), now);
                }
                let _ = app.emit("vault:file-changed", FileChangedPayload { path: rel });
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
