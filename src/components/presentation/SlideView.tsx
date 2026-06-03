import { createElement, Fragment, type ReactNode } from 'react';
import 'katex/dist/katex.min.css';
import { renderInlineMarkdown } from '@/components/markdown/InlineMarkdown';
import { renderKatex } from '@/components/editor/math/katex-render';
import type { Slide } from '@/lib/presentation/splitSlides';

/**
 * Renders one slide's markdown as static prose.
 *
 * We reuse the existing inline renderer (`renderInlineMarkdown`) and the
 * existing KaTeX helper (`renderKatex`), styled by the existing
 * `.prose-mycel` rules in `index.css`. A slide is presentation output, not
 * an editor: there are no CodeMirror widgets here, so databases and tables
 * render read-only by construction and links are inert (clicks are
 * swallowed at the overlay level to keep the audience in the show).
 *
 * The block grammar handled here mirrors what the editor's live preview
 * recognises: ATX headings, fenced code, block math, blockquotes,
 * unordered/ordered lists, pipe tables, horizontal rules and paragraphs.
 */

// ── inline helpers ──────────────────────────────────────────────────────────

/** Inline render that also resolves `$…$` math, which the shared inline
 *  renderer doesn't know about. Splits the text on inline-math spans and
 *  hands the non-math pieces to `renderInlineMarkdown`. */
function renderInline(text: string): ReactNode {
  if (!text) return null;
  const parts: ReactNode[] = [];
  const re = /(?<!\\)\$([^\n$]+?)(?<!\\)\$/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      parts.push(
        <Fragment key={key++}>
          {renderInlineMarkdown(text.slice(last, m.index))}
        </Fragment>,
      );
    }
    const { html, error } = renderKatex(m[1], false);
    if (error) {
      parts.push(
        <Fragment key={key++}>{renderInlineMarkdown(m[0])}</Fragment>,
      );
    } else {
      parts.push(
        <span key={key++} dangerouslySetInnerHTML={{ __html: html }} />,
      );
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) {
    parts.push(
      <Fragment key={key++}>
        {renderInlineMarkdown(text.slice(last))}
      </Fragment>,
    );
  }
  return parts;
}

// ── block parsing ───────────────────────────────────────────────────────────

const FENCE_RE = /^(\s*)(`{3,}|~{3,})(.*)$/;
const HEADING_RE = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const HR_RE = /^\s*([-*_])(?:\s*\1){2,}\s*$/;
const UL_RE = /^(\s*)[-*+]\s+(.*)$/;
const OL_RE = /^(\s*)(\d+)[.)]\s+(.*)$/;
const BLOCKQUOTE_RE = /^\s*>\s?(.*)$/;
const TASK_RE = /^\[([ xX])\]\s+(.*)$/;

interface ListItem {
  content: string;
}

function renderListItem(raw: string, key: number): ReactNode {
  const task = raw.match(TASK_RE);
  if (task) {
    const checked = task[1].toLowerCase() === 'x';
    return (
      <li key={key}>
        <input type="checkbox" checked={checked} readOnly tabIndex={-1} />
        {renderInline(task[2])}
      </li>
    );
  }
  return <li key={key}>{renderInline(raw)}</li>;
}

function isTableSeparator(line: string): boolean {
  return /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/.test(line) &&
    line.includes('-');
}

function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  // Split on unescaped pipes.
  return s.split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, '|').trim());
}

export function renderSlideMarkdown(md: string): ReactNode {
  const lines = md.split('\n');
  const out: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    // blank line — skip
    if (line.trim() === '') {
      i++;
      continue;
    }

    // fenced code block
    const fence = line.match(FENCE_RE);
    if (fence) {
      const marker = fence[2];
      const lang = fence[3].trim();
      const body: string[] = [];
      i++;
      while (i < lines.length) {
        const l = lines[i];
        if (l.trim().startsWith(marker[0].repeat(3)) && l.trim().length >= 3 && /^[`~]+\s*$/.test(l.trim())) {
          i++;
          break;
        }
        body.push(lines[i]);
        i++;
      }
      out.push(
        <pre key={key++}>
          <code className={lang ? `language-${lang}` : undefined}>
            {body.join('\n')}
          </code>
        </pre>,
      );
      continue;
    }

    // block math $$ … $$
    if (line.trim().startsWith('$$')) {
      const startRest = line.trim().slice(2);
      const body: string[] = [];
      // single-line $$ x $$
      if (startRest.trim().endsWith('$$') && startRest.trim().length >= 2) {
        body.push(startRest.trim().slice(0, -2));
        i++;
      } else {
        if (startRest.trim()) body.push(startRest);
        i++;
        while (i < lines.length) {
          const l = lines[i].trim();
          if (l.endsWith('$$')) {
            const inner = l.slice(0, -2);
            if (inner.trim()) body.push(inner);
            i++;
            break;
          }
          body.push(lines[i]);
          i++;
        }
      }
      const { html, error } = renderKatex(body.join('\n').trim(), true);
      out.push(
        error ? (
          <pre key={key++}>
            <code>{body.join('\n')}</code>
          </pre>
        ) : (
          <div
            key={key++}
            className="slide-math-block"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        ),
      );
      continue;
    }

    // horizontal rule (an inner one; slide separators are already stripped)
    if (HR_RE.test(line)) {
      out.push(<hr key={key++} />);
      i++;
      continue;
    }

    // heading
    const h = line.match(HEADING_RE);
    if (h) {
      const level = h[1].length;
      out.push(
        createElement(`h${level}`, { key: key++ }, renderInline(h[2])),
      );
      i++;
      continue;
    }

    // blockquote (consume consecutive `>` lines)
    if (BLOCKQUOTE_RE.test(line)) {
      const inner: string[] = [];
      while (i < lines.length && BLOCKQUOTE_RE.test(lines[i])) {
        inner.push(lines[i].match(BLOCKQUOTE_RE)![1]);
        i++;
      }
      out.push(
        <blockquote key={key++}>{renderSlideMarkdown(inner.join('\n'))}</blockquote>,
      );
      continue;
    }

    // table (header row + separator row)
    if (line.includes('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      const header = splitRow(line);
      i += 2; // skip header + separator
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '') {
        rows.push(splitRow(lines[i]));
        i++;
      }
      out.push(
        <table key={key++}>
          <thead>
            <tr>
              {header.map((c, ci) => (
                <th key={ci}>{renderInline(c)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, ri) => (
              <tr key={ri}>
                {header.map((_, ci) => (
                  <td key={ci}>{renderInline(r[ci] ?? '')}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>,
      );
      continue;
    }

    // unordered / ordered list (consume contiguous list lines of same kind)
    const ul = line.match(UL_RE);
    const ol = line.match(OL_RE);
    if (ul || ol) {
      const ordered = !!ol;
      const items: ListItem[] = [];
      while (i < lines.length) {
        const um = lines[i].match(UL_RE);
        const om = lines[i].match(OL_RE);
        if (ordered && om) items.push({ content: om[3] });
        else if (!ordered && um) items.push({ content: um[2] });
        else break;
        i++;
      }
      const children = items.map((it, idx) => renderListItem(it.content, idx));
      out.push(
        ordered ? <ol key={key++}>{children}</ol> : <ul key={key++}>{children}</ul>,
      );
      continue;
    }

    // paragraph — gather until blank line or a block starter
    const para: string[] = [];
    while (i < lines.length) {
      const l = lines[i];
      if (
        l.trim() === '' ||
        FENCE_RE.test(l) ||
        HEADING_RE.test(l) ||
        HR_RE.test(l) ||
        BLOCKQUOTE_RE.test(l) ||
        UL_RE.test(l) ||
        OL_RE.test(l) ||
        l.trim().startsWith('$$')
      ) {
        break;
      }
      para.push(l);
      i++;
    }
    if (para.length) {
      out.push(<p key={key++}>{renderInline(para.join('\n'))}</p>);
    }
  }

  return out;
}

export function SlideView({ slide }: { slide: Slide }) {
  return (
    <div className="prose-mycel mx-auto" style={{ maxWidth: '820px' }}>
      {renderSlideMarkdown(slide.md)}
    </div>
  );
}
