import { useEffect, useRef, useCallback, useState } from 'react';
import { Database } from 'lucide-react';
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
import { syntaxHighlighting, defaultHighlightStyle, HighlightStyle } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import { autocompletion } from '@codemirror/autocomplete';
import 'katex/dist/katex.min.css';
import { useVaultStore } from '@/stores/vault';
import { wikilinkCompletions } from './WikilinkCompletion';
import { slashCompletions } from './SlashCompletion';
import { markdownPreviewPlugin, markdownPreviewTheme } from './MarkdownDecorations';
import { externalLinkClickHandler } from './ExternalLinkNavigation';
import {
  mathDecorationField,
  mathAtomicRangesField,
  mathDecorationTheme,
} from './decorations/MathDecoration';
import { imageDecorationField, imageDecorationTheme } from './decorations/ImageDecoration';
import { databaseWidgetPlugin, databaseWidgetTheme } from '@/lib/codemirror/database-widget';
import { editableTableWidgetPlugin, editableTableWidgetTheme } from '@/lib/codemirror/editable-table-widget';
import { registerEditorView, unregisterEditorView } from '@/lib/editor-registry';
import { DatabasePicker } from '@/components/database/DatabasePicker';
import { insertDbFence } from '@/lib/database/insert';
import { EncryptedNoteBanner } from '@/components/crypto/EncryptedNoteBanner';
import { isEncryptedPath } from '@/lib/note-name';
import {
  extFromMime,
  insertImageLink,
  isImageFilename,
  saveAttachmentBytes,
  saveAttachmentFile,
} from '@/lib/attachments';

const themeCompartment = new Compartment();

/**
 * Mycel editor theme — calm dark workspace with acid-moss accents.
 * Reads colors from CSS custom properties so the theme follows the
 * active light/dark palette declared in `index.css`.
 */
const mycelEditorTheme = (dark: boolean) =>
  EditorView.theme(
    {
      '&': {
        backgroundColor: 'var(--color-surface-1)',
        color: 'var(--color-text-primary)',
        height: '100%',
        fontFamily: "'Inter', system-ui, sans-serif",
        fontSize: '16px',
      },
      '.cm-scroller': { overflow: 'auto', lineHeight: '1.75', width: '100%' },
      '.cm-content': { caretColor: 'var(--color-accent)' },
      '.cm-activeLine': { backgroundColor: 'var(--color-active-line)' },
      '.cm-activeLineGutter': {
        backgroundColor: 'var(--color-active-line)',
        color: 'var(--color-text-secondary)',
      },
      '.cm-gutters': {
        backgroundColor: 'var(--color-surface-1)',
        borderRight: '1px solid var(--color-border)',
        color: 'var(--color-text-muted)',
      },
      '.cm-cursor': { borderLeftColor: 'var(--color-accent)' },
      '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection':
        { backgroundColor: 'var(--color-selection)' },
      '.cm-tooltip': {
        backgroundColor: 'var(--color-surface-2)',
        border: '1px solid var(--color-border)',
        color: 'var(--color-text-primary)',
      },
      '.cm-tooltip-autocomplete': {
        backgroundColor: 'var(--color-surface-2)',
        border: '1px solid var(--color-border)',
        borderRadius: '6px',
        boxShadow: 'var(--shadow-glow)',
      },
      '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
        backgroundColor: 'var(--color-surface-hover)',
        color: 'var(--color-text-primary)',
      },
      '.cm-completionLabel': { color: 'var(--color-text-primary)' },
      '.cm-completionDetail': { color: 'var(--color-text-muted)', fontSize: '11px' },
      '.cm-completionMatchedText': {
        color: 'var(--color-accent)',
        textDecoration: 'none',
        fontWeight: '600',
      },
      '.cm-panels': {
        backgroundColor: 'var(--color-surface-0)',
        color: 'var(--color-text-secondary)',
      },
      '.cm-searchMatch': { backgroundColor: 'var(--color-semantic-glow)' },
      '.cm-searchMatch.cm-searchMatch-selected': {
        backgroundColor: 'color-mix(in srgb, var(--color-accent) 35%, transparent)',
      },
      '.cm-selectionMatch': {
        backgroundColor: 'color-mix(in srgb, var(--color-accent) 18%, transparent)',
      },
    },
    { dark },
  );

const mycelHighlightStyle = HighlightStyle.define([
  { tag: t.heading, color: 'var(--color-text-primary)', fontWeight: '700' },
  { tag: t.strong, fontWeight: '700' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.link, color: 'var(--color-accent)', textDecoration: 'underline' },
  { tag: t.url, color: 'var(--color-info)' },
  { tag: t.keyword, color: 'var(--color-accent-bright)' },
  { tag: [t.string, t.special(t.string)], color: 'var(--color-embedding)' },
  { tag: t.comment, color: 'var(--color-text-muted)', fontStyle: 'italic' },
  { tag: t.number, color: 'var(--color-warning)' },
  { tag: t.bool, color: 'var(--color-warning)' },
  { tag: [t.variableName, t.propertyName], color: 'var(--color-text-primary)' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: 'var(--color-accent-bright)' },
  { tag: [t.typeName, t.className], color: 'var(--color-tag)' },
  { tag: t.tagName, color: 'var(--color-accent)' },
  { tag: t.attributeName, color: 'var(--color-accent-muted)' },
  { tag: t.operator, color: 'var(--color-text-secondary)' },
  { tag: t.punctuation, color: 'var(--color-text-muted)' },
  { tag: t.invalid, color: 'var(--color-error)' },
  { tag: t.monospace, color: 'var(--color-inline-code)' },
]);

interface Props {
  path: string;
}

export function MarkdownEditor({ path }: Props) {
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const { noteCache, saveNote, markDirty, updateNoteLive } = useVaultStore();
  const liveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isDark = document.documentElement.classList.contains('dark');
  const [pickerOpen, setPickerOpen] = useState(false);
  const slashRangeRef = useRef<{ from: number; to: number } | null>(null);

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
        externalLinkClickHandler,
        mathDecorationField,
        mathAtomicRangesField,
        mathDecorationTheme,
        imageDecorationField,
        imageDecorationTheme,
        editableTableWidgetPlugin(),
        editableTableWidgetTheme,
        databaseWidgetPlugin(path),
        databaseWidgetTheme,
        autocompletion({
          override: [slashCompletions, wikilinkCompletions],
          activateOnTyping: true,
        }),
        themeCompartment.of(
          [
            mycelEditorTheme(isDark),
            syntaxHighlighting(isDark ? mycelHighlightStyle : defaultHighlightStyle),
          ],
        ),
        EditorView.updateListener.of((update: ViewUpdate) => {
          if (update.docChanged) {
            markDirty(path, true);
            if (liveTimerRef.current) clearTimeout(liveTimerRef.current);
            liveTimerRef.current = setTimeout(() => {
              updateNoteLive(path, update.state.doc.toString());
            }, 150);
          }
        }),
        EditorView.lineWrapping,
      ],
    });

    const view = new EditorView({ state, parent: editorRef.current });
    viewRef.current = view;
    registerEditorView(path, view);

    const onOpenDbPicker = (e: Event) => {
      const detail = (e as CustomEvent<{ from: number; to: number }>).detail;
      slashRangeRef.current = detail
        ? { from: detail.from, to: detail.to }
        : null;
      setPickerOpen(true);
    };
    view.dom.addEventListener('mycel:open-db-picker', onOpenDbPicker);

    // ── Paste: capture image bytes from clipboard ──────────────────────
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (!file) continue;
          e.preventDefault();
          void (async () => {
            try {
              const buf = new Uint8Array(await file.arrayBuffer());
              const ext = extFromMime(file.type);
              const rel = await saveAttachmentBytes(buf, ext);
              insertImageLink(view, rel);
            } catch (err) {
              console.error('Paste image failed:', err);
            }
          })();
          return;
        }
      }
    };
    view.dom.addEventListener('paste', onPaste);

    // ── Drag-and-drop: copy dropped files into attachments/ ────────────
    const onDragOver = (e: DragEvent) => {
      if (e.dataTransfer?.types?.includes('Files')) {
        e.preventDefault();
        view.dom.classList.add('cm-drop-target');
      }
    };
    const onDragLeave = () => view.dom.classList.remove('cm-drop-target');
    const onDrop = (e: DragEvent) => {
      const files = e.dataTransfer?.files;
      if (!files || files.length === 0) return;
      const imageFiles = Array.from(files).filter(
        (f) => f.type.startsWith('image/') || isImageFilename(f.name),
      );
      if (imageFiles.length === 0) return;
      e.preventDefault();
      view.dom.classList.remove('cm-drop-target');
      void (async () => {
        for (const f of imageFiles) {
          try {
            // Tauri exposes the native path on File via a non-standard
            // property; falling back to bytes preserves drag-from-browser.
            const tauriPath = (f as unknown as { path?: string }).path;
            const rel = tauriPath
              ? await saveAttachmentFile(tauriPath)
              : await saveAttachmentBytes(
                  new Uint8Array(await f.arrayBuffer()),
                  extFromMime(f.type) || (f.name.split('.').pop() ?? 'bin'),
                );
            insertImageLink(view, rel);
          } catch (err) {
            console.error('Drop image failed:', err);
          }
        }
      })();
    };
    view.dom.addEventListener('dragover', onDragOver);
    view.dom.addEventListener('dragleave', onDragLeave);
    view.dom.addEventListener('drop', onDrop);

    return () => {
      if (liveTimerRef.current) {
        clearTimeout(liveTimerRef.current);
        liveTimerRef.current = null;
      }
      view.dom.removeEventListener('mycel:open-db-picker', onOpenDbPicker);
      view.dom.removeEventListener('paste', onPaste);
      view.dom.removeEventListener('dragover', onDragOver);
      view.dom.removeEventListener('dragleave', onDragLeave);
      view.dom.removeEventListener('drop', onDrop);
      unregisterEditorView(path, view);
      view.destroy();
      viewRef.current = null;
    };
  }, [path]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: themeCompartment.reconfigure([
        mycelEditorTheme(isDark),
        syntaxHighlighting(isDark ? mycelHighlightStyle : defaultHighlightStyle),
      ]),
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
      {isEncryptedPath(path) && <EncryptedNoteBanner path={path} />}
      <div className="flex items-center justify-between px-4 py-1.5 border-b border-border bg-surface-0 shrink-0">
        <span className="text-xs text-text-muted font-mono">{path}</span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => {
              slashRangeRef.current = null;
              setPickerOpen(true);
            }}
            className="flex items-center gap-1 text-xs text-text-muted hover:text-text-primary px-2 py-0.5 rounded hover:bg-surface-hover transition-colors"
            title="Insert database"
          >
            <Database size={12} /> DB
          </button>
          <button
            onClick={() => handleSave(viewRef.current?.state.doc.toString() ?? note.content)}
            className="text-xs text-text-muted hover:text-text-primary px-2 py-0.5 rounded hover:bg-surface-hover transition-colors"
            title="Save (Ctrl/Cmd+S)"
          >
            Save
          </button>
        </div>
      </div>

      <div ref={editorRef} className="flex-1 overflow-hidden" />

      {pickerOpen && (
        <DatabasePicker
          currentNotePath={path}
          onCancel={() => {
            setPickerOpen(false);
            slashRangeRef.current = null;
          }}
          onPick={(source, viewId) => {
            const view = viewRef.current;
            setPickerOpen(false);
            if (!view) return;
            const range = slashRangeRef.current;
            slashRangeRef.current = null;
            insertDbFence(view, {
              source,
              view: viewId,
              replaceFrom: range?.from,
              replaceTo: range?.to,
            });
          }}
        />
      )}
    </div>
  );
}
