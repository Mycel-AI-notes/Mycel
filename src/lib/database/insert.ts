import type { EditorView } from '@codemirror/view';

export interface InsertSpec {
  source: string;
  view?: string;
  // If provided, replace this range with the fence (used by slash-command trigger)
  replaceFrom?: number;
  replaceTo?: number;
}

export function buildDbFence(source: string, viewId?: string): string {
  const lines = ['```db', `source: ${source}`];
  if (viewId) lines.push(`view: ${viewId}`);
  lines.push('```');
  return lines.join('\n');
}

export function insertDbFence(view: EditorView, spec: InsertSpec): void {
  const fence = buildDbFence(spec.source, spec.view);
  const sel = view.state.selection.main;
  const from = spec.replaceFrom ?? sel.from;
  const to = spec.replaceTo ?? sel.to;

  // Ensure block sits on its own line: prepend a newline if not at line start.
  const lineAtFrom = view.state.doc.lineAt(from);
  const needLeadingNl = from !== lineAtFrom.from;
  const text = (needLeadingNl ? '\n' : '') + fence + '\n';

  view.dispatch({
    changes: { from, to, insert: text },
    selection: { anchor: from + text.length },
  });
  view.focus();
}
