import type { EditorView } from '@codemirror/view';
import { emptyTable, serializeTable } from './serialize';

export interface InsertSpec {
  replaceFrom?: number;
  replaceTo?: number;
}

export function buildTableFence(): string {
  return ['```mdtable', serializeTable(emptyTable()), '```'].join('\n');
}

export function insertTableFence(view: EditorView, spec: InsertSpec = {}): void {
  const fence = buildTableFence();
  const sel = view.state.selection.main;
  const from = spec.replaceFrom ?? sel.from;
  const to = spec.replaceTo ?? sel.to;

  const lineAtFrom = view.state.doc.lineAt(from);
  const needLeadingNl = from !== lineAtFrom.from;
  const text = (needLeadingNl ? '\n' : '') + fence + '\n';

  view.dispatch({
    changes: { from, to, insert: text },
    selection: { anchor: from + text.length },
  });
  view.focus();
}
