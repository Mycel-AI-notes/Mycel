import { useEffect, useMemo, useState } from 'react';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { ExternalLink } from 'lucide-react';
import { useVaultStore } from '@/stores/vault';
import { resolveWikilink } from './WikilinkNavigation';
import { renderSlideMarkdown } from '@/components/presentation/SlideView';
import { extractEmbedSection } from '@/lib/embed';
import { displayName } from '@/lib/note-name';
import type { FileEntry, Note } from '@/types';

export interface NoteEmbedProps {
  target: string;
  anchor: string | null;
  /** The note the embed sits in — embedding it into itself is refused. */
  hostPath: string;
}

type Loaded =
  | { kind: 'loading' }
  | { kind: 'missing' }
  | { kind: 'self' }
  | { kind: 'unreadable'; path: string }
  | { kind: 'note'; path: string; content: string };

/**
 * Read-only render of an embedded note (or one of its sections).
 *
 * Recursion is bounded by construction: the body is rendered with the
 * slide renderer, which shows a nested `![[…]]` as a plain link rather than
 * another embed. So an embed is always one level deep, and two notes
 * embedding each other cannot loop. Embedding a note into itself is refused
 * outright — it would only show the text right above it.
 *
 * Content comes from the open editor's live copy when the target is open in
 * a tab, and from disk otherwise; it refetches when the vault saves.
 */
export function NoteEmbed({ target, anchor, hostPath }: NoteEmbedProps) {
  const vaultVersion = useVaultStore((s) => s.vaultVersion);
  const [loaded, setLoaded] = useState<Loaded>({ kind: 'loading' });
  const livePath = loaded.kind === 'note' || loaded.kind === 'unreadable' ? loaded.path : null;
  const liveContent = useVaultStore((s) => (livePath ? s.noteCache.get(livePath)?.content : undefined));

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const path = await resolveWikilink(target);
      if (cancelled) return;
      if (!path) return setLoaded({ kind: 'missing' });
      if (path === hostPath) return setLoaded({ kind: 'self' });
      const cached = useVaultStore.getState().noteCache.get(path)?.content;
      if (cached !== undefined) return setLoaded({ kind: 'note', path, content: cached });
      try {
        const note = await invoke<Note>('note_read', { path });
        if (!cancelled) setLoaded({ kind: 'note', path, content: note.content });
      } catch {
        // Typically an encrypted note while the vault is locked.
        if (!cancelled) setLoaded({ kind: 'unreadable', path });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [target, hostPath, vaultVersion]);

  const content = liveContent ?? (loaded.kind === 'note' ? loaded.content : null);
  const section = useMemo(
    () => (content === null ? null : extractEmbedSection(content, anchor)),
    [content, anchor],
  );

  const open = () => {
    if (livePath) void useVaultStore.getState().openNote(livePath);
  };
  const label = livePath ? displayName(livePath) : target;

  let body;
  if (loaded.kind === 'loading') body = <p className="cm-note-embed-msg">Loading…</p>;
  else if (loaded.kind === 'missing') body = <p className="cm-note-embed-msg">No note named “{target}”.</p>;
  else if (loaded.kind === 'self') body = <p className="cm-note-embed-msg">A note can’t embed itself.</p>;
  else if (content === null) body = <p className="cm-note-embed-msg">Locked or unreadable.</p>;
  else if (section === null) body = <p className="cm-note-embed-msg">No heading “{anchor}” in this note.</p>;
  else body = <div className="prose-mycel cm-note-embed-body">{renderSlideMarkdown(section)}</div>;

  return (
    <>
      <div className="cm-note-embed-header">
        <button type="button" className="cm-note-embed-title" onClick={open} disabled={!livePath} title="Open note">
          {label}
          {anchor && <span className="cm-note-embed-anchor"> › {anchor}</span>}
        </button>
        {livePath && (
          <button type="button" className="cm-note-embed-open" onClick={open} title="Open note">
            <ExternalLink size={12} />
          </button>
        )}
      </div>
      {body}
    </>
  );
}

/** Find an attachment by path or bare file name, the way Obsidian resolves
 *  `![[pic.png]]` regardless of which folder the picture lives in. */
function findAttachment(tree: FileEntry[], target: string): string | null {
  const wanted = target.toLowerCase();
  let byName: string | null = null;
  const walk = (entries: FileEntry[]): string | null => {
    for (const e of entries) {
      if (e.is_dir) {
        const hit = walk(e.children ?? []);
        if (hit) return hit;
        continue;
      }
      const p = e.path.toLowerCase();
      if (p === wanted) return e.path;
      if (!byName && (p.endsWith(`/${wanted}`) || e.name.toLowerCase() === wanted)) byName = e.path;
    }
    return null;
  };
  return walk(tree) ?? byName;
}

export function ImageEmbed({ target }: { target: string }) {
  const tree = useVaultStore((s) => s.fileTree);
  const root = useVaultStore((s) => s.vaultRoot);
  const path = useMemo(() => findAttachment(tree, target), [tree, target]);
  if (!path || !root) return <p className="cm-note-embed-msg">Image not found: {target}</p>;
  return (
    <img
      src={convertFileSrc(`${root}/${path}`)}
      alt={target}
      className="cm-image-preview-img"
      style={{ cursor: 'zoom-in' }}
      onClick={() => useVaultStore.getState().openImageTab(path, { preview: true })}
    />
  );
}
