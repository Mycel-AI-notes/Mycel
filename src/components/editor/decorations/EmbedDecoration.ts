/**
 * Inline `![[Note]]` embeds. Each embed gets a read-only block widget under
 * its line showing the target note — or its `#heading` section, or the
 * picture for `![[pic.png]]` — while the `![[…]]` source stays on the line
 * above, editable like any other text (the same arrangement the image
 * preview uses for mixed lines).
 *
 * A StateField rather than a ViewPlugin because CodeMirror only accepts
 * block widgets from state fields. Parsing is `lib/embed.ts`; the widget
 * body is React (`NoteEmbed.tsx`).
 */
import { Decoration, DecorationSet, EditorView, WidgetType } from '@codemirror/view';
import { EditorState, Facet, StateField } from '@codemirror/state';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { findEmbeds, isImageEmbed } from '@/lib/embed';
import { ImageEmbed, NoteEmbed, type NoteEmbedProps } from '../NoteEmbed';

/** Path of the note an editor shows, so an embed can refuse to show itself. */
export const embedHostPath = Facet.define<string, string>({
  combine: (values) => values[0] ?? '',
});

const unmounts = new WeakMap<HTMLElement, () => void>();

/** Render an embed into a widget's DOM node; returns its unmount. */
function mountEmbed(el: HTMLElement, props: NoteEmbedProps): () => void {
  const root = createRoot(el);
  root.render(
    isImageEmbed(props.target)
      ? createElement(ImageEmbed, { target: props.target })
      : createElement(NoteEmbed, props),
  );
  // Deferred: CodeMirror destroys widgets inside its own update, and a
  // synchronous unmount there can land while React is mid-render.
  return () => queueMicrotask(() => root.unmount());
}

class EmbedWidget extends WidgetType {
  constructor(
    readonly target: string,
    readonly anchor: string | null,
    readonly hostPath: string,
  ) {
    super();
  }

  eq(other: EmbedWidget): boolean {
    return (
      this.target === other.target &&
      this.anchor === other.anchor &&
      this.hostPath === other.hostPath
    );
  }

  toDOM(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'cm-note-embed';
    wrap.contentEditable = 'false';
    unmounts.set(
      wrap,
      mountEmbed(wrap, { target: this.target, anchor: this.anchor, hostPath: this.hostPath }),
    );
    return wrap;
  }

  destroy(dom: HTMLElement): void {
    unmounts.get(dom)?.();
    unmounts.delete(dom);
  }

  ignoreEvent(): boolean {
    // Clicks inside the embed (open, links) are the widget's own; without
    // this CodeMirror would also move the caret and steal focus.
    return true;
  }
}

function buildEmbedDecorations(state: EditorState): DecorationSet {
  const host = state.facet(embedHostPath);
  const embeds = findEmbeds(state.doc.toString());
  const decos = embeds.map((e) => {
    const lineEnd = state.doc.lineAt(e.from).to;
    return Decoration.widget({
      widget: new EmbedWidget(e.target, e.anchor, host),
      side: 1,
      block: true,
    }).range(lineEnd);
  });
  return Decoration.set(decos, true);
}

export const embedDecorationField = StateField.define<DecorationSet>({
  create: buildEmbedDecorations,
  update(value, tr) {
    return tr.docChanged ? buildEmbedDecorations(tr.state) : value;
  },
  provide: (f) => EditorView.decorations.from(f),
});

export const embedDecorationTheme = EditorView.baseTheme({
  '.cm-note-embed': {
    display: 'block',
    margin: '6px 24px 10px',
    padding: '6px 12px 10px',
    borderLeft: '3px solid var(--color-accent)',
    borderRadius: '4px',
    backgroundColor: 'var(--color-surface-0)',
    cursor: 'default',
  },
  '.cm-note-embed-header': {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '11px',
    paddingBottom: '4px',
  },
  '.cm-note-embed-title': {
    flex: '1',
    textAlign: 'left',
    color: 'var(--color-text-muted)',
    background: 'none',
    border: 'none',
    padding: '0',
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontSize: 'inherit',
  },
  '.cm-note-embed-title:hover:not(:disabled)': { color: 'var(--color-accent)' },
  '.cm-note-embed-anchor': { opacity: '0.8' },
  '.cm-note-embed-open': {
    color: 'var(--color-text-muted)',
    background: 'none',
    border: 'none',
    padding: '2px',
    cursor: 'pointer',
  },
  '.cm-note-embed-open:hover': { color: 'var(--color-accent)' },
  '.cm-note-embed-body': {
    maxHeight: '28rem',
    overflowY: 'auto',
    fontSize: '15px',
  },
  '.cm-note-embed-msg': {
    margin: '0',
    color: 'var(--color-text-muted)',
    fontSize: '13px',
    fontStyle: 'italic',
  },
});
