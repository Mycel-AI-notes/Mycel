import { useEffect, useRef, useCallback, useState } from 'react';
import { Database, Play } from 'lucide-react';
import { EditorState, Compartment } from '@codemirror/state';
import {
  EditorView,
  keymap,
  highlightActiveLine,
  ViewUpdate,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { search, searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { mycelSearchPanel } from '@/lib/codemirror/search-panel';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { syntaxHighlighting, defaultHighlightStyle, HighlightStyle } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import { autocompletion } from '@codemirror/autocomplete';
import 'katex/dist/katex.min.css';
import { useVaultStore } from '@/stores/vault';
import { useUIStore } from '@/stores/ui';
import { focusDim } from '@/lib/codemirror/focus-dim';
import { ghostLinks } from '@/lib/codemirror/ghost-link';
import { wikilinkCompletions } from './WikilinkCompletion';
import { slashCompletions } from './SlashCompletion';
import { markdownPreviewPlugin, markdownPreviewTheme } from './MarkdownDecorations';
import { externalLinkClickHandler } from './ExternalLinkNavigation';
import { makeWikilinkClickHandler } from './WikilinkNavigation';
import {
  mathDecorationField,
  mathAtomicRangesField,
  mathDecorationTheme,
} from './decorations/MathDecoration';
import { imageDecorationField, imageDecorationTheme } from './decorations/ImageDecoration';
import {
  embedDecorationField,
  embedDecorationTheme,
  embedHostPath,
} from './decorations/EmbedDecoration';
import { databaseWidgetPlugin, databaseWidgetTheme } from '@/lib/codemirror/database-widget';
import { editableTableWidgetPlugin, editableTableWidgetTheme } from '@/lib/codemirror/editable-table-widget';
import { registerEditorView, unregisterEditorView } from '@/lib/editor-registry';
import { flushAutosave, scheduleAutosave } from '@/lib/autosave';
import { DatabasePicker } from '@/components/database/DatabasePicker';
import { insertDbFence } from '@/lib/database/insert';
import { EncryptedNoteBanner } from '@/components/crypto/EncryptedNoteBanner';
import { isEncryptedPath } from '@/lib/note-name';
import { QUICK_NOTES_DIR } from '@/types';
import { QuickFilingBar } from './QuickFilingBar';
import { MyceliumMargin } from './MyceliumMargin';
import { usePresentationStore } from '@/stores/presentation';
import { SAVE_EVENT } from '@/lib/app-commands';
import {
  extFromMime,
  insertImageLink,
  isImageFilename,
  saveAttachmentBytes,
  saveAttachmentFile,
} from '@/lib/attachments';

const themeCompartment = new Compartment();
/** Focus-mode paragraph dimming, switched on and off without rebuilding. */
const focusCompartment = new Compartment();

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
      // The search panel itself is a custom floating card — see
      // `lib/codemirror/search-panel.ts` and the `.mycel-search*` rules in
      // `index.css`. Panels float over the content rather than push it down.
      '.cm-panels': { backgroundColor: 'transparent', color: 'var(--color-text-secondary)' },
      '.cm-panels.cm-panels-top': {
        position: 'absolute',
        top: '10px',
        right: '16px',
        left: 'auto',
        zIndex: '12',
        borderBottom: 'none',
      },
      '.cm-searchMatch': {
        backgroundColor: 'var(--color-semantic-glow)',
        borderRadius: '2px',
      },
      '.cm-searchMatch.cm-searchMatch-selected': {
        backgroundColor: 'color-mix(in srgb, var(--color-accent) 38%, transparent)',
        outline: '1px solid color-mix(in srgb, var(--color-accent) 60%, transparent)',
        borderRadius: '2px',
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
  const { noteCache, saveNote, markDirty, updateNoteLive, openNote, createNote } = useVaultStore();
  const liveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isDark = document.documentElement.classList.contains('dark');
  const [pickerOpen, setPickerOpen] = useState(false);
  const slashRangeRef = useRef<{ from: number; to: number } | null>(null);

  const note = noteCache.get(path);
  const focusMode = useUIStore((s) => s.focusMode);
  // Edit subscribers outside React state, so a keystroke doesn't re-render
  // this component (the margin debounces on them).
  const editListeners = useRef(new Set<() => void>());
  const getView = useCallback(() => viewRef.current, []);
  const onEdit = useCallback((fn: () => void) => {
    editListeners.current.add(fn);
    return () => {
      editListeners.current.delete(fn);
    };
  }, []);
  const readableWidth = useUIStore((s) => s.features.readableWidth !== false);

  // Bumped after every successful save of a quick note; the filing bar
  // below the editor re-asks the backend for suggestions on each bump.
  const [saveTick, setSaveTick] = useState(0);
  const isQuickNote = path.startsWith(`${QUICK_NOTES_DIR}/`) && !isEncryptedPath(path);

  const handleSave = useCallback(
    async (content: string) => {
      try {
        await saveNote(path, content);
        if (isQuickNote) setSaveTick((t) => t + 1);
      } catch {
        // `saveNote` raises a toast; the tab stays dirty and the autosave
        // timer keeps the path pending so the next flush retries.
      }
    },
    [path, saveNote, isQuickNote],
  );

  useEffect(() => {
    if (!editorRef.current || !note) return;

    const state = EditorState.create({
      doc: note.content,
      extensions: [
        history(),
        highlightActiveLine(),
        keymap.of([...searchKeymap, ...defaultKeymap, ...historyKeymap, indentWithTab]),
        search({ top: true, createPanel: mycelSearchPanel }),
        highlightSelectionMatches(),
        markdown({
          base: markdownLanguage,
          codeLanguages: languages,
        }),
        markdownPreviewPlugin,
        markdownPreviewTheme,
        externalLinkClickHandler,
        makeWikilinkClickHandler(openNote, createNote),
        mathDecorationField,
        mathAtomicRangesField,
        mathDecorationTheme,
        imageDecorationField,
        imageDecorationTheme,
        embedHostPath.of(path),
        embedDecorationField,
        embedDecorationTheme,
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
        focusCompartment.of(useUIStore.getState().focusMode ? focusDim : []),
        ghostLinks(
          () =>
            useVaultStore.getState().noteCache.get(path)?.parsed?.meta?.title ??
            path.split('/').pop()?.replace(/\.md$/, ''),
        ),
        EditorView.updateListener.of((update: ViewUpdate) => {
          if (update.docChanged) {
            markDirty(path, true);
            editListeners.current.forEach((fn) => fn());
            // Edits reach disk on their own now. Cmd+S still works and is
            // still the way to pin a preview tab, but it is no longer the
            // only thing standing between a thought and losing it.
            scheduleAutosave(path);
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

    // Save arrives as an event from the `note.save` command rather than a
    // CodeMirror keymap, so the hotkey is whatever the user bound it to.
    const onSaveRequest = () => handleSave(view.state.doc.toString());
    view.dom.addEventListener(SAVE_EVENT, onSaveRequest);

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
      // Last chance to write: after this the view is destroyed and its text is
      // gone. The autosave timer reads from the live view, so it cannot run
      // once we are past here.
      void flushAutosave(path);
      if (liveTimerRef.current) {
        clearTimeout(liveTimerRef.current);
        liveTimerRef.current = null;
      }
      view.dom.removeEventListener('mycel:open-db-picker', onOpenDbPicker);
      view.dom.removeEventListener(SAVE_EVENT, onSaveRequest);
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

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: focusCompartment.reconfigure(focusMode ? focusDim : []),
    });
  }, [focusMode]);

  if (!note)
    return (
      <div className="flex-1 flex items-center justify-center text-text-muted text-sm">
        Loading…
      </div>
    );

  return (
    <div className="flex flex-col h-full myc-rooted">
      {isEncryptedPath(path) && <EncryptedNoteBanner path={path} />}
      {!focusMode && (
        <div className="flex items-center justify-between px-4 py-1.5 border-b border-border bg-surface-0 shrink-0">
          <span className="text-xs text-text-muted font-mono">{path}</span>
          <div className="flex items-center gap-1">
            <button
              onClick={() =>
                usePresentationStore
                  .getState()
                  .start(viewRef.current?.state.doc.toString() ?? note.content, path)
              }
              className="flex items-center gap-1 text-xs text-text-muted hover:text-text-primary px-2 py-0.5 rounded hover:bg-surface-hover transition-colors"
              title="Present"
            >
              <Play size={12} /> Play
            </button>
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
              title="Save"
            >
              Save
            </button>
          </div>
        </div>
      )}

      <div
        ref={editorRef}
        className={`flex-1 overflow-hidden${readableWidth || focusMode ? ' myc-readable' : ''}${focusMode ? ' myc-focus' : ''}`}
      />

      {!focusMode && <MyceliumMargin path={path} view={getView} onEdit={onEdit} />}

      {isQuickNote && <QuickFilingBar path={path} saveTick={saveTick} />}

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
