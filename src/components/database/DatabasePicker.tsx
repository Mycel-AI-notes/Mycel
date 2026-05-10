import { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { dbApi } from '@/lib/database/api';
import { Plus, Database } from 'lucide-react';

interface ViewSummary {
  id: string;
  label: string;
}
interface DbSummary {
  path: string;
  name: string;
  views: ViewSummary[];
}

interface Props {
  currentNotePath: string;
  onPick: (source: string, viewId: string | undefined) => void;
  onCancel: () => void;
}

function dirOf(p: string) {
  const i = p.lastIndexOf('/');
  return i >= 0 ? p.slice(0, i) : '';
}

function relativeFrom(noteDir: string, dbPath: string): string {
  // If db is in same dir → just the filename. If in subfolder of noteDir → relative.
  // Otherwise return vault-absolute (with leading /) for clarity.
  if (!noteDir) return dbPath;
  if (dbPath.startsWith(noteDir + '/')) {
    return dbPath.slice(noteDir.length + 1);
  }
  return '/' + dbPath;
}

export function DatabasePicker({ currentNotePath, onPick, onCancel }: Props) {
  const [items, setItems] = useState<DbSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<DbSummary | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');

  useEffect(() => {
    void invoke<DbSummary[]>('dbs_list')
      .then((data) => setItems(data))
      .catch((e) => console.error(e))
      .finally(() => setLoading(false));
  }, []);

  const noteDir = dirOf(currentNotePath);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (it) => it.name.toLowerCase().includes(q) || it.path.toLowerCase().includes(q),
    );
  }, [items, query]);

  function pick(db: DbSummary, viewId?: string) {
    const source = relativeFrom(noteDir, db.path);
    onPick(source, viewId);
  }

  async function createNew() {
    const name = newName.trim();
    if (!name) return;
    const fileName = name.endsWith('.db.json') ? name : `${name}.db.json`;
    const path = (noteDir ? noteDir + '/' : '') + fileName;
    try {
      await dbApi.create(path);
      const source = relativeFrom(noteDir, path);
      onPick(source, 'default');
    } catch (e) {
      alert(String(e));
    }
  }

  return (
    <div className="db-modal-overlay" onMouseDown={onCancel}>
      <div className="db-modal db-picker" onMouseDown={(e) => e.stopPropagation()}>
        {!creating && !selected && (
          <>
            <h3 className="db-modal-title">Insert database</h3>
            <input
              autoFocus
              className="db-popover-input db-picker-search"
              placeholder="Search databases…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') onCancel();
                if (e.key === 'Enter' && filtered[0]) {
                  if (filtered[0].views.length <= 1) {
                    pick(filtered[0], filtered[0].views[0]?.id);
                  } else {
                    setSelected(filtered[0]);
                  }
                }
              }}
            />
            <div className="db-picker-list">
              {loading && <div className="db-picker-empty">Loading…</div>}
              {!loading && filtered.length === 0 && (
                <div className="db-picker-empty">No databases yet.</div>
              )}
              {filtered.map((it) => (
                <button
                  key={it.path}
                  className="db-picker-item"
                  onClick={() => {
                    if (it.views.length <= 1) pick(it, it.views[0]?.id);
                    else setSelected(it);
                  }}
                >
                  <Database size={14} />
                  <span className="db-picker-name">{it.name}</span>
                  <span className="db-picker-path">{it.path}</span>
                </button>
              ))}
            </div>
            <div className="db-modal-actions">
              <button className="db-btn" onClick={onCancel}>
                Cancel
              </button>
              <button
                className="db-btn db-btn-primary"
                onClick={() => setCreating(true)}
              >
                <Plus size={12} /> New database
              </button>
            </div>
          </>
        )}

        {selected && (
          <>
            <h3 className="db-modal-title">Choose view — {selected.name}</h3>
            <div className="db-picker-list">
              {selected.views.map((v) => (
                <button
                  key={v.id}
                  className="db-picker-item"
                  onClick={() => pick(selected, v.id)}
                >
                  <span className="db-picker-name">{v.label}</span>
                  <span className="db-picker-path">{v.id}</span>
                </button>
              ))}
            </div>
            <div className="db-modal-actions">
              <button className="db-btn" onClick={() => setSelected(null)}>
                Back
              </button>
            </div>
          </>
        )}

        {creating && (
          <>
            <h3 className="db-modal-title">New database</h3>
            <label className="db-modal-field">
              <span>Name</span>
              <input
                autoFocus
                placeholder="books"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void createNew();
                  if (e.key === 'Escape') setCreating(false);
                }}
              />
              <span className="db-picker-hint">
                Will be saved as <code>{(noteDir ? noteDir + '/' : '') + (newName || 'name') + '.db.json'}</code>
              </span>
            </label>
            <div className="db-modal-actions">
              <button className="db-btn" onClick={() => setCreating(false)}>
                Back
              </button>
              <button className="db-btn db-btn-primary" onClick={createNew}>
                Create
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
