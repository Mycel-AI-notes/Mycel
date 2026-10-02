import { CompletionContext, CompletionResult, autocompletion } from '@codemirror/autocomplete';
import { linkCompletionEntries, type LinkableNote } from '@/lib/wikilink-path';
import { listNotes } from './WikilinkNavigation';

let notesCache: LinkableNote[] = [];

/** Refresh the snapshot the (synchronous) completion source reads.
 *  `listNotes` is memoized on the vault version and file tree, so this is
 *  free unless something changed — which is also how a newly added alias
 *  shows up without reopening the vault. */
async function loadNotes() {
  try {
    notesCache = await listNotes();
  } catch {
    // Vault might not be open yet
  }
}

export function invalidateNotesCache() {
  notesCache = [];
}

export function wikilinkCompletions(context: CompletionContext): CompletionResult | null {
  // Match [[ followed by any text (no closing bracket yet)
  const match = context.matchBefore(/\[\[[^\]]*$/);
  if (!match) return null;

  const options = linkCompletionEntries(notesCache).map((e) => ({ ...e, type: 'text' }));

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
