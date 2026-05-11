import { CompletionContext, CompletionResult, autocompletion } from '@codemirror/autocomplete';
import { invoke } from '@tauri-apps/api/core';

interface NoteSummary {
  path: string;
  title: string;
}

let notesCache: NoteSummary[] = [];
let cacheLoaded = false;

async function loadNotes() {
  if (cacheLoaded) return;
  try {
    notesCache = await invoke<NoteSummary[]>('notes_list');
    cacheLoaded = true;
  } catch {
    // Vault might not be open yet
  }
}

export function invalidateNotesCache() {
  cacheLoaded = false;
  notesCache = [];
}

export function wikilinkCompletions(context: CompletionContext): CompletionResult | null {
  // Match [[ followed by any text (no closing bracket yet)
  const match = context.matchBefore(/\[\[[^\]]*$/);
  if (!match) return null;

  const options = notesCache.map((n) => ({
    label: n.title,
    apply: `${n.title}]]`,
    detail: n.path,
    type: 'text',
  }));

  void loadNotes();

  return {
    from: match.from + 2,
    options,
    validFor: /^[^\]]*$/,
  };
}

export const wikilinkAutocomplete = autocompletion({
  override: [wikilinkCompletions],
  activateOnTyping: true,
});
