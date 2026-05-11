import type { EditorView } from '@codemirror/view';
import { emptyTable, serializeTable } from './serialize';

export interface InsertSpec {
  replaceFrom?: number;
  replaceTo?: number;
}

export function buildEmptyTableMarkdown(): string {
  return serializeTable(emptyTable());
}

export function insertTableFence(view: EditorView, spec: InsertSpec = {}): void {
  const md = buildEmptyTableMarkdown();
  const sel = view.state.selection.main;
  const from = spec.replaceFrom ?? sel.from;
  const to = spec.replaceTo ?? sel.to;

  // The widget needs a blank line above so the table block stands on its own.
  const lineAtFrom = view.state.doc.lineAt(from);
  const needLeadingNl = from !== lineAtFrom.from;
  const text = (needLeadingNl ? '\n' : '') + md + '\n';

  view.dispatch({
    changes: { from, to, insert: text },
    selection: { anchor: from + text.length },
  });
  view.focus();
}
