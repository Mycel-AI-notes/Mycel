import {
  CompletionContext,
  CompletionResult,
  Completion,
} from '@codemirror/autocomplete';
import type { EditorView } from '@codemirror/view';
import { insertTableFence } from '@/lib/table/insert';

export interface SlashCommand {
  label: string;
  detail: string;
  keywords?: string[];
  run: (view: EditorView, from: number, to: number) => void;
}

const COMMANDS: SlashCommand[] = [
  {
    label: 'Table',
    detail: 'Insert an editable markdown table',
    keywords: ['table', 'tbl', 'grid'],
    run: (view, from, to) => {
      insertTableFence(view, { replaceFrom: from, replaceTo: to });
    },
  },
  {
    label: 'Database',
    detail: 'Embed a database view',
    keywords: ['db', 'database'],
    run: (view, from, to) => {
      // Database insertion needs a picker, so dispatch a custom event the
      // MarkdownEditor listens for. Replace the slash trigger immediately so
      // the picker sees a clean cursor position.
      view.dispatch({
        changes: { from, to, insert: '' },
        selection: { anchor: from },
      });
      view.dom.dispatchEvent(
        new CustomEvent('mycel:open-db-picker', {
          bubbles: true,
          detail: { from, to: from },
        }),
      );
    },
  },
];

interface OpenDbPickerDetail {
  from: number;
  to: number;
}

export type OpenDbPickerEvent = CustomEvent<OpenDbPickerDetail>;

export function slashCompletions(
  context: CompletionContext,
): CompletionResult | null {
  // Trigger when the user has typed `/` followed by zero or more word chars
  // at the start of a line (or after whitespace). Matching the leading space
  // would consume it, so use a lookbehind via matchBefore on the slash itself.
  const match = context.matchBefore(/(?:^|\s)\/\w*/);
  if (!match) return null;

  const slashIndex = match.text.indexOf('/');
  const from = match.from + slashIndex;
  const query = match.text.slice(slashIndex + 1).toLowerCase();

  // Don't open on bare slash unless explicitly invoked, so `/foo bar /baz`
  // mid-word doesn't keep popping menus when the user just types math like
  // `a/b`.
  if (!context.explicit && match.text.length === slashIndex + 1) {
    // Allow opening on bare `/` only when at line start to keep things calm.
    const lineStart = context.state.doc.lineAt(from).from;
    if (from !== lineStart) return null;
  }

  const options: Completion[] = COMMANDS.filter((cmd) => {
    if (!query) return true;
    const hay = [cmd.label.toLowerCase(), ...(cmd.keywords ?? [])].join(' ');
    return hay.includes(query);
  }).map((cmd) => ({
    label: '/' + cmd.label,
    detail: cmd.detail,
    type: 'keyword',
    apply: (view, _completion, applyFrom, applyTo) => {
      cmd.run(view, applyFrom, applyTo);
    },
  }));

  if (options.length === 0) return null;

  return {
    from,
    options,
    validFor: /^\/\w*$/,
  };
}
