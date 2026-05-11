/**
 * Inline image previews in the editor. Markdown image links
 * `![alt](src)` get a Decoration.widget placed AFTER the markdown line so
 * the source stays editable and the rendered image appears underneath —
 * the Typora-style flow the spec calls for.
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
  ) {
    super();
  }

  eq(other: ImageWidget): boolean {
    return (
      this.alt === other.alt &&
      this.src === other.src &&
      this.resolvedSrc === other.resolvedSrc &&
      this.external === other.external
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'cm-image-preview';
    wrap.contentEditable = 'false';

    const img = document.createElement('img');
    img.alt = this.alt;
    img.src = this.resolvedSrc;
    img.draggable = false;
    img.className = 'cm-image-preview-img';

    const placeholder = document.createElement('div');
    placeholder.className = 'cm-image-placeholder';
    placeholder.textContent = `⚠ Image not found: ${this.src}`;

    img.addEventListener('error', () => {
      img.style.display = 'none';
      placeholder.style.display = 'block';
    });

    // Single click — let CodeMirror place the caret in the markdown source
    // so the user can edit the alt/src.
    img.addEventListener('click', (e) => {
      e.preventDefault();
      const pos = view.posAtDOM(wrap);
      view.dispatch({ selection: { anchor: pos } });
      view.focus();
    });

    if (!this.external) {
      img.addEventListener('dblclick', async (e) => {
        e.preventDefault();
        try {
          const { openPath } = await import('@tauri-apps/plugin-opener');
          const root = useVaultStore.getState().vaultRoot;
          if (root) await openPath(`${root}/${this.src}`);
        } catch {
          // Best-effort: failures here aren't actionable for the user.
        }
      });
    }

    if (this.external) {
      const badge = document.createElement('button');
      badge.className = 'cm-image-external-action';
      badge.type = 'button';
      badge.textContent = '⬇ Save locally';
      badge.title = 'Download to attachments/ and rewrite the link';
      badge.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        wrap.dispatchEvent(
          new CustomEvent('mycel:download-external-image', {
            bubbles: true,
            detail: { url: this.src },
          }),
        );
      });
      wrap.appendChild(badge);
    }

    placeholder.style.display = 'none';
    wrap.appendChild(img);
    wrap.appendChild(placeholder);
    return wrap;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

function absoluteAttachmentPath(relative: string): string {
  const root = useVaultStore.getState().vaultRoot;
  if (!root) return relative;
  const clean = relative.replace(/^\/+/, '');
  return `${root}/${clean}`;
}

function buildImageDecorations(state: EditorState): DecorationSet {
  const { doc, selection: sel } = state;

  type Item = { pos: number; deco: Decoration };
  const items: Item[] = [];

  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n);
    const matches = findImageMatches(line.text, line.from);
    if (matches.length === 0) continue;
    const cursorOnLine = sel.ranges.some(
      (r) => r.from <= line.to && r.to >= line.from,
    );
    if (cursorOnLine) continue;
    for (const m of matches) {
      const resolved = m.isExternal
        ? m.src
        : convertFileSrc(absoluteAttachmentPath(m.src));
      items.push({
        pos: line.to,
        deco: Decoration.widget({
          widget: new ImageWidget(m.alt, m.src, resolved, m.isExternal),
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
    if (tr.docChanged || tr.selection) {
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
    padding: '4px',
    borderRadius: '6px',
    backgroundColor: 'var(--color-surface-1)',
    position: 'relative',
  },
  '.cm-image-preview-img': {
    maxWidth: '100%',
    height: 'auto',
    display: 'block',
    borderRadius: '4px',
    cursor: 'pointer',
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
  '.cm-image-external-action': {
    position: 'absolute',
    top: '8px',
    right: '8px',
    padding: '4px 8px',
    fontSize: '11px',
    color: 'var(--color-text-primary)',
    backgroundColor: 'var(--color-surface-2)',
    border: '1px solid var(--color-border)',
    borderRadius: '4px',
    cursor: 'pointer',
    opacity: '0',
    transition: 'opacity 150ms ease',
  },
  '.cm-image-preview:hover .cm-image-external-action': {
    opacity: '1',
  },
  '.cm-drop-target': {
    outline: '2px dashed var(--color-accent)',
    outlineOffset: '-4px',
  },
});
