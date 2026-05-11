/**
 * Inline image previews in the editor. Markdown image links
 * `![alt](src)` get a Decoration.widget placed AFTER the markdown line so
 * the preview is always visible — the markdown source stays editable
 * on the line above, like the table widget pattern. The widget carries
 * its own toolbar (delete, open, save-locally) so the user can act on
 * the image without ever needing to "exit" a hidden-decoration mode.
 *
 * Local paths route through Tauri's asset:// protocol so the webview
 * can load files outside the dev server's root. Remote URLs are rendered
 * directly; if they fail we swap in a placeholder so the editor never
 * shows a broken-image icon.
 *
 * Implemented as a StateField — CodeMirror requires block widgets to
 * come from a state field, never from a plugin.
 */
import {
  Decoration,
  DecorationSet,
  EditorView,
  WidgetType,
} from '@codemirror/view';
import { EditorState, StateField } from '@codemirror/state';
import { convertFileSrc } from '@tauri-apps/api/core';
import { useVaultStore } from '@/stores/vault';

export interface ImageMatch {
  /** Document offset of the opening `!` */
  from: number;
  /** Document offset just past the closing `)` */
  to: number;
  alt: string;
  src: string;
  isExternal: boolean;
}

const IMAGE_RE = /!\[([^\]\n]*)\]\(([^)\s]+)\)/g;

function isExternal(src: string): boolean {
  return /^(https?:|data:|blob:)/i.test(src);
}

export function findImageMatches(text: string, offset: number): ImageMatch[] {
  const out: ImageMatch[] = [];
  for (const m of text.matchAll(IMAGE_RE)) {
    if (m.index === undefined) continue;
    out.push({
      from: offset + m.index,
      to: offset + m.index + m[0].length,
      alt: m[1],
      src: m[2],
      isExternal: isExternal(m[2]),
    });
  }
  return out;
}

class ImageWidget extends WidgetType {
  constructor(
    public readonly alt: string,
    public readonly src: string,
    public readonly resolvedSrc: string,
    public readonly external: boolean,
    /** Markdown source range — used by the delete button to remove the
     * `![…](…)` text exactly, without depending on cursor position. */
    public readonly srcFrom: number,
    public readonly srcTo: number,
  ) {
    super();
  }

  eq(other: ImageWidget): boolean {
    return (
      this.alt === other.alt &&
      this.src === other.src &&
      this.resolvedSrc === other.resolvedSrc &&
      this.external === other.external &&
      this.srcFrom === other.srcFrom &&
      this.srcTo === other.srcTo
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'cm-image-preview';
    wrap.contentEditable = 'false';

    // Stop bubbling so clicks inside the widget never steal focus from
    // the surrounding editor — that was causing the preview to flicker
    // and the action buttons to become unclickable.
    const stop = (e: Event) => e.stopPropagation();
    wrap.addEventListener('mousedown', stop);
    wrap.addEventListener('mouseup', stop);
    wrap.addEventListener('click', stop);

    const img = document.createElement('img');
    img.alt = this.alt;
    img.src = this.resolvedSrc;
    img.draggable = false;
    img.className = 'cm-image-preview-img';

    const placeholder = document.createElement('div');
    placeholder.className = 'cm-image-placeholder';
    placeholder.textContent = `⚠ Image not found: ${this.src}`;
    placeholder.style.display = 'none';

    img.addEventListener('error', () => {
      img.style.display = 'none';
      placeholder.style.display = 'block';
    });

    if (!this.external) {
      img.style.cursor = 'zoom-in';
      img.addEventListener('click', () => {
        useVaultStore.getState().openImageTab(this.src, { preview: true });
      });
    }

    // ── Toolbar ──────────────────────────────────────────────────────
    const toolbar = document.createElement('div');
    toolbar.className = 'cm-image-toolbar';

    const meta = document.createElement('span');
    meta.className = 'cm-image-meta';
    meta.textContent = this.src;
    toolbar.appendChild(meta);

    const spacer = document.createElement('span');
    spacer.className = 'cm-image-spacer';
    toolbar.appendChild(spacer);

    if (this.external) {
      const save = makeButton('⬇ Save locally', 'Download to attachments/ and rewrite the link');
      save.addEventListener('click', () => {
        wrap.dispatchEvent(
          new CustomEvent('mycel:download-external-image', {
            bubbles: true,
            detail: { url: this.src },
          }),
        );
      });
      toolbar.appendChild(save);
    } else {
      const open = makeButton('↗ Open in tab', 'Open this image in a new tab');
      open.addEventListener('click', () => {
        useVaultStore.getState().openImageTab(this.src, { preview: true });
      });
      toolbar.appendChild(open);
    }

    const del = makeButton('✕ Remove', 'Remove this image link from the note');
    del.classList.add('cm-image-btn-danger');
    del.addEventListener('click', () => {
      const doc = view.state.doc;
      // Also swallow the trailing newline so the document doesn't end up
      // with an empty line where the image used to be.
      let to = this.srcTo;
      if (to < doc.length && doc.sliceString(to, to + 1) === '\n') to += 1;
      view.dispatch({
        changes: { from: this.srcFrom, to, insert: '' },
      });
    });
    toolbar.appendChild(del);

    wrap.appendChild(toolbar);
    wrap.appendChild(img);
    wrap.appendChild(placeholder);
    return wrap;
  }

  ignoreEvent(): boolean {
    // Block CodeMirror from interpreting widget clicks as caret moves
    // — that was what made the preview vanish the moment the user
    // tried to press "Save locally".
    return true;
  }
}

function makeButton(label: string, title: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'cm-image-btn';
  b.textContent = label;
  b.title = title;
  return b;
}

function absoluteAttachmentPath(relative: string): string {
  const root = useVaultStore.getState().vaultRoot;
  if (!root) return relative;
  const clean = relative.replace(/^\/+/, '');
  return `${root}/${clean}`;
}

function buildImageDecorations(state: EditorState): DecorationSet {
  const { doc } = state;

  type Item = { pos: number; deco: Decoration };
  const items: Item[] = [];

  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n);
    const matches = findImageMatches(line.text, line.from);
    if (matches.length === 0) continue;
    for (const m of matches) {
      const resolved = m.isExternal
        ? m.src
        : convertFileSrc(absoluteAttachmentPath(m.src));
      items.push({
        pos: line.to,
        deco: Decoration.widget({
          widget: new ImageWidget(m.alt, m.src, resolved, m.isExternal, m.from, m.to),
          side: 1,
          block: true,
        }),
      });
    }
  }

  items.sort((a, b) => a.pos - b.pos);
  return Decoration.set(
    items.map((it) => it.deco.range(it.pos)),
    true,
  );
}

export const imageDecorationField = StateField.define<DecorationSet>({
  create(state) {
    return buildImageDecorations(state);
  },
  update(value, tr) {
    if (tr.docChanged) {
      return buildImageDecorations(tr.state);
    }
    return value;
  },
  provide: (f) => EditorView.decorations.from(f),
});

export const imageDecorationTheme = EditorView.baseTheme({
  '.cm-image-preview': {
    display: 'block',
    margin: '8px 24px',
    padding: '6px',
    borderRadius: '6px',
    backgroundColor: 'var(--color-surface-1)',
    border: '1px solid var(--color-border)',
    position: 'relative',
  },
  '.cm-image-preview-img': {
    maxWidth: '100%',
    height: 'auto',
    display: 'block',
    borderRadius: '4px',
    margin: '0 auto',
  },
  '.cm-image-placeholder': {
    padding: '24px',
    textAlign: 'center',
    color: 'var(--color-text-muted)',
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: '12px',
    border: '1px dashed var(--color-border)',
    borderRadius: '4px',
  },
  '.cm-image-toolbar': {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '2px 4px 6px 4px',
    fontSize: '11px',
  },
  '.cm-image-meta': {
    color: 'var(--color-text-muted)',
    fontFamily: "'JetBrains Mono', monospace",
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    maxWidth: '40%',
  },
  '.cm-image-spacer': { flex: '1' },
  '.cm-image-btn': {
    padding: '3px 8px',
    fontSize: '11px',
    color: 'var(--color-text-primary)',
    backgroundColor: 'var(--color-surface-2)',
    border: '1px solid var(--color-border)',
    borderRadius: '4px',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  '.cm-image-btn:hover': {
    backgroundColor: 'var(--color-surface-hover)',
  },
  '.cm-image-btn-danger:hover': {
    backgroundColor: 'color-mix(in srgb, var(--color-error) 18%, transparent)',
    borderColor: 'var(--color-error)',
    color: 'var(--color-error)',
  },
  '.cm-drop-target': {
    outline: '2px dashed var(--color-accent)',
    outlineOffset: '-4px',
  },
});
