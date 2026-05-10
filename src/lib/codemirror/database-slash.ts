import { ViewPlugin, ViewUpdate } from '@codemirror/view';

interface Options {
  openPicker: (replaceFrom: number, replaceTo: number) => void;
}

// Watches for `/db`, `/database`, `/table` typed at the end of the cursor
// position. When detected, opens the picker; the matched range is forwarded so
// the picker can replace it with the inserted fence on confirm.
export function databaseSlashCommand(opts: Options) {
  return ViewPlugin.fromClass(
    class {
      private armed = true;

      update(update: ViewUpdate) {
        if (!update.docChanged || !this.armed) return;

        const view = update.view;
        const pos = view.state.selection.main.head;
        const line = view.state.doc.lineAt(pos);
        const before = view.state.doc.sliceString(line.from, pos);

        const m = before.match(/(?:^|\s)\/(db|database|table)$/i);
        if (!m) return;

        const triggerLen = 1 + m[1].length;
        const from = pos - triggerLen;

        this.armed = false;
        setTimeout(() => {
          this.armed = true;
        }, 250);

        opts.openPicker(from, pos);
      }
    },
  );
}
