import { EditorView } from '@codemirror/view';
import { openUrl } from '@tauri-apps/plugin-opener';

// Tauri's webview won't follow plain anchor clicks (target=_blank is a no-op
// without an explicit opener call), so we intercept clicks on rendered link
// widgets and route them through the system browser via the opener plugin.
//
// We act on `mousedown` rather than `click`. A click first moves the editor
// selection into the link span, which makes the live-preview plugin swap the
// rendered <a> widget back to its raw `[text](url)` markdown. By the time a
// `click` event fires the anchor is already gone, so we'd have nothing to read
// the URL from — the link appeared to do nothing but reveal its source.
// Handling mousedown (before the selection update) keeps the anchor in the DOM
// and lets us both read the URL and prevent the caret from jumping in.
export const externalLinkClickHandler = EditorView.domEventHandlers({
  mousedown(event) {
    // Only follow a plain left click. Let middle/right clicks and modified
    // clicks (used for selecting text) fall through to the editor.
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey ||
      event.shiftKey
    ) {
      return false;
    }
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
