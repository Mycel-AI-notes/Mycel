import { EditorView } from '@codemirror/view';
import { openUrl } from '@tauri-apps/plugin-opener';

// Tauri's webview won't follow plain anchor clicks (target=_blank is a no-op
// without an explicit opener call), so we intercept clicks on rendered link
// widgets and route them through the system browser via the opener plugin.
export const externalLinkClickHandler = EditorView.domEventHandlers({
  click(event) {
    const el = (event.target as HTMLElement | null)?.closest?.(
      'a.cm-md-link',
    ) as HTMLAnchorElement | null;
    if (!el) return false;
    const url = el.dataset.url || el.getAttribute('href');
    if (!url) return false;
    event.preventDefault();
    void openUrl(url).catch((err) => {
      console.error('Open URL failed:', err);
    });
    return true;
  },
});
