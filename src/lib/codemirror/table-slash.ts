import { ViewPlugin, ViewUpdate } from '@codemirror/view';
import { insertTableFence } from '@/lib/table/insert';

// Watches for `/table` typed at the cursor and replaces it with a fresh
// `mdtable` block. The database picker handles `/db` and `/database`; we keep
// `/table` here so a typed slash command always means "markdown table".
export function tableSlashCommand() {
  return ViewPlugin.fromClass(
    class {
      private armed = true;

      update(update: ViewUpdate) {
        if (!update.docChanged || !this.armed) return;

        const view = update.view;
        const pos = view.state.selection.main.head;
        const line = view.state.doc.lineAt(pos);
        const before = view.state.doc.sliceString(line.from, pos);

        const m = before.match(/(?:^|\s)\/(table|tbl)$/i);
        if (!m) return;

        const triggerLen = 1 + m[1].length;
        const from = pos - triggerLen;

        this.armed = false;
        setTimeout(() => {
          this.armed = true;
        }, 250);

        queueMicrotask(() => {
          insertTableFence(view, { replaceFrom: from, replaceTo: pos });
        });
      }
    },
  );
}
