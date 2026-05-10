import { useEffect, useRef, useCallback } from 'react';
import { EditorState, Compartment } from '@codemirror/state';
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  ViewUpdate,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { oneDark } from '@codemirror/theme-one-dark';
import { syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language';
import { useVaultStore } from '@/stores/vault';
import { wikilinkAutocomplete } from './WikilinkCompletion';
import { markdownPreviewPlugin, markdownPreviewTheme } from './MarkdownDecorations';

const themeCompartment = new Compartment();

const lightTheme = EditorView.theme(
  {
    '&': {
      backgroundColor: 'var(--color-surface-1)',
      color: 'var(--color-text-primary)',
      height: '100%',
      fontFamily: "'Inter', system-ui, sans-serif",
      fontSize: '16px',
    },
    '.cm-scroller': { overflow: 'auto', lineHeight: '1.75' },
    '.cm-content': { caretColor: 'var(--color-accent)' },
    '.cm-activeLine': { backgroundColor: 'rgba(0,0,0,0.03)' },
    '.cm-activeLineGutter': { backgroundColor: 'rgba(0,0,0,0.03)' },
    '.cm-gutters': {
      backgroundColor: 'var(--color-surface-1)',
      borderRight: '1px solid var(--color-border)',
      color: 'var(--color-text-muted)',
    },
    '.cm-cursor': { borderLeftColor: 'var(--color-accent)' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
      backgroundColor: 'rgba(99, 102, 241, 0.15)',
    },
    '.cm-tooltip-autocomplete': {
      backgroundColor: 'var(--color-surface-0)',
      border: '1px solid var(--color-border)',
      borderRadius: '6px',
    },
    '.cm-completionLabel': { color: 'var(--color-text-primary)' },
    '.cm-completionDetail': { color: 'var(--color-text-muted)', fontSize: '11px' },
  },
  { dark: false },
);

interface Props {
  path: string;
}

export function MarkdownEditor({ path }: Props) {
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const { noteCache, saveNote, markDirty } = useVaultStore();
  const isDark = document.documentElement.classList.contains('dark');

  const note = noteCache.get(path);

  const handleSave = useCallback(
    async (content: string) => {
      try {
        await saveNote(path, content);
      } catch (e) {
        console.error('Save failed:', e);
      }
    },
    [path, saveNote],
  );

  useEffect(() => {
    if (!editorRef.current || !note) return;

    const saveKeymap = keymap.of([
      {
        key: 'Mod-s',
        run: (view) => {
          handleSave(view.state.doc.toString());
          return true;
        },
      },
    ]);

    const state = EditorState.create({
      doc: note.content,
      extensions: [
        history(),
        lineNumbers(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
        saveKeymap,
        markdown({
          base: markdownLanguage,
          codeLanguages: languages,
        }),
        markdownPreviewPlugin,
        markdownPreviewTheme,
        wikilinkAutocomplete,
        themeCompartment.of(
          isDark ? oneDark : [lightTheme, syntaxHighlighting(defaultHighlightStyle)],
        ),
        EditorView.updateListener.of((update: ViewUpdate) => {
          if (update.docChanged) {
            markDirty(path, true);
          }
        }),
        EditorView.lineWrapping,
      ],
    });

    const view = new EditorView({ state, parent: editorRef.current });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [path]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: themeCompartment.reconfigure(
        isDark ? oneDark : [lightTheme, syntaxHighlighting(defaultHighlightStyle)],
      ),
    });
  }, [isDark]);

  if (!note)
    return (
      <div className="flex-1 flex items-center justify-center text-text-muted text-sm">
        Loading…
      </div>
    );

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-1.5 border-b border-border bg-surface-0 shrink-0">
        <span className="text-xs text-text-muted font-mono">{path}</span>
        <button
          onClick={() => handleSave(viewRef.current?.state.doc.toString() ?? note.content)}
          className="text-xs text-text-muted hover:text-text-primary px-2 py-0.5 rounded hover:bg-white/10"
          title="Save (Ctrl/Cmd+S)"
        >
          Save
        </button>
      </div>

      <div ref={editorRef} className="flex-1 overflow-hidden" />
    </div>
  );
}
