/**
 * Pure helpers shared by the inline and block math decorations. Lives in
 * `lib/` so the CodeMirror plugins and any future math utilities (slash
 * inserter, export) all parse `$…$` and `$$…$$` the same way.
 */
import type { EditorState } from '@codemirror/state';

export interface MathRange {
  from: number;
  to: number;
  body: string;
  kind: 'inline' | 'block';
}

/**
 * Scan the whole document and yield every math span. We deliberately do a
 * single-pass scan rather than per-line regex so block math (`$$…$$` that
 * spans lines) is handled correctly. Inline `$…$` is consumed after block
 * detection so `$$x$$` doesn't accidentally produce two inline spans.
 *
 * Skips dollar signs inside fenced code blocks because LaTeX in code
 * fences should stay as-is.
 */
export function parseMathRanges(state: EditorState): MathRange[] {
  const doc = state.doc.toString();
  const out: MathRange[] = [];

  const codeMask = buildCodeMask(state);
  const inCode = (pos: number) => codeMask[pos] === 1;

  let i = 0;
  while (i < doc.length) {
    if (doc[i] !== '$' || inCode(i)) {
      i++;
      continue;
    }

    // Block math: $$ … $$
    if (doc[i + 1] === '$') {
      const start = i;
      let j = i + 2;
      let end = -1;
      while (j < doc.length - 1) {
        if (doc[j] === '$' && doc[j + 1] === '$' && doc[j - 1] !== '\\') {
          end = j + 2;
          break;
        }
        j++;
      }
      if (end > 0) {
        const body = doc.slice(start + 2, end - 2);
        if (body.trim().length > 0) {
          out.push({ from: start, to: end, body, kind: 'block' });
        }
        i = end;
        continue;
      }
      // Unclosed `$$` — bail out, the user is mid-typing.
      i = start + 2;
      continue;
    }

    // Inline math: $ … $ on a single line, no internal `$`. We require a
    // non-space immediately after the opener so currency / variable names
    // like `cost is $5` don't get matched.
    const after = doc[i + 1];
    if (!after || after === ' ' || after === '\n' || after === '$') {
      i++;
      continue;
    }
    let j = i + 1;
    let end = -1;
    while (j < doc.length) {
      const c = doc[j];
      if (c === '\n') break;
      if (c === '$' && doc[j - 1] !== '\\') {
        // Require a non-space before the closer too so `$5 dollars$ later`
        // doesn't trigger.
        if (doc[j - 1] !== ' ') {
          end = j + 1;
        }
        break;
      }
      j++;
    }
    if (end > 0) {
      out.push({
        from: i,
        to: end,
        body: doc.slice(i + 1, end - 1),
        kind: 'inline',
      });
      i = end;
    } else {
      i++;
    }
  }

  return out;
}

/**
 * Returns a Uint8Array sized to the document where positions inside a
 * fenced code block are 1. We use a flat mask so the math scanner can
 * skip code spans without re-tokenising per range.
 */
function buildCodeMask(state: EditorState): Uint8Array {
  const text = state.doc.toString();
  const mask = new Uint8Array(text.length);
  let inFence = false;
  let lineStart = 0;
  for (let i = 0; i <= text.length; i++) {
    if (i === text.length || text[i] === '\n') {
      const line = text.slice(lineStart, i);
      const isFence = /^```/.test(line);
      if (isFence) {
        // Mark the fence line itself, then flip state.
        for (let p = lineStart; p < i; p++) mask[p] = 1;
        inFence = !inFence;
      } else if (inFence) {
        for (let p = lineStart; p < i; p++) mask[p] = 1;
      }
      lineStart = i + 1;
    }
  }
  return mask;
}

export function findMathAt(ranges: MathRange[], pos: number): MathRange | null {
  for (const r of ranges) {
    if (pos >= r.from && pos <= r.to) return r;
  }
  return null;
}
