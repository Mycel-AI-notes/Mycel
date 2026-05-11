import katex from 'katex';

export interface KatexRenderResult {
  html: string;
  error: string | null;
}

/**
 * Render a LaTeX snippet to a sanitized HTML string. KaTeX throws on
 * invalid syntax; we catch it and surface the message so the editor can
 * render an inline error marker without crashing the whole plugin.
 *
 * `throwOnError: false` would also work, but we want to distinguish
 * "rendered fine" from "rendered as an error span" for theming.
 */
export function renderKatex(
  source: string,
  displayMode: boolean,
): KatexRenderResult {
  try {
    const html = katex.renderToString(source, {
      displayMode,
      throwOnError: true,
      strict: 'ignore',
      output: 'html',
      trust: false,
    });
    return { html, error: null };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { html: '', error: message };
  }
}
