import { createElement, Fragment, type ReactNode } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import 'katex/dist/katex.min.css';
import { renderInlineMarkdown } from '@/components/markdown/InlineMarkdown';
import { renderKatex } from '@/components/editor/math/katex-render';
import { resolveWikilink } from '@/components/editor/WikilinkNavigation';
import { useVaultStore } from '@/stores/vault';
import { usePresentationStore } from '@/stores/presentation';
import type { Slide } from '@/lib/presentation/splitSlides';

/** Follow a wikilink target: leave the show and open the linked note
 *  (creating it when missing), so the user lands where they clicked. */
function followWikilink(target: string) {
  const { openNote, createNote } = useVaultStore.getState();
  usePresentationStore.getState().close();
  void resolveWikilink(target).then((path) => {
    if (path) void openNote(path);
    else void createNote(`${target}.md`);
  });
}

/** External link that opens in the system browser. The Tauri webview won't
 *  follow a plain anchor, so we route the click through the opener plugin —
 *  the same path the editor uses for rendered links. */
function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      title={href}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.preventDefault();
        void openUrl(href).catch((err) => console.error('Open URL failed:', err));
      }}
    >
      {children}
    </a>
  );
}

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

/** Resolve an image `src` to something the webview can load. External URLs
 *  pass through; local attachment paths are made absolute against the vault
 *  root and routed through Tauri's asset protocol (same as the editor). */
function resolveImageSrc(src: string): string {
  if (/^(https?:|data:|blob:)/i.test(src)) return src;
  try {
    const root = useVaultStore.getState().vaultRoot;
    if (!root) return src;
    const clean = src.replace(/^\/+/, '');
    return convertFileSrc(`${root}/${clean}`);
  } catch {
    return src;
  }
}

// Tokens the shared inline renderer can't handle on its own, in priority
// order: image, markdown link, wikilink, bare URL, inline math. Markdown and
// bare links are pulled out here so every external link routes through the
// opener plugin instead of relying on dead anchor navigation.
//   1 alt    2 src        (image)
//   3 label  4 url        (markdown link)
//   5 target 6 alias      (wikilink)
//   7 url                 (bare URL)
//   8 body                (inline math)
const INLINE_TOKEN_RE =
  /!\[([^\]\n]*)\]\(([^)\n]+)\)|\[([^\]\n]+)\]\(([^)\s]+)\)|\[\[([^\]|\n]+)(?:\|([^\]\n]+))?\]\]|(https?:\/\/[^\s<>"')\]]+)|(?<!\\)\$([^\n$]+?)(?<!\\)\$/g;

/** Inline render that resolves images, clickable external/wiki links and
 *  `$…$` math, splitting the text on those spans and handing the rest to
 *  `renderInlineMarkdown` (bold / italic / code / strike). */
function renderInline(text: string): ReactNode {
  if (!text) return null;
  const parts: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  INLINE_TOKEN_RE.lastIndex = 0;
  while ((m = INLINE_TOKEN_RE.exec(text)) !== null) {
    if (m.index > last) {
      parts.push(
        <Fragment key={key++}>
          {renderInlineMarkdown(text.slice(last, m.index))}
        </Fragment>,
      );
    }
    if (m[2] !== undefined) {
      // image
      parts.push(
        <img
          key={key++}
          src={resolveImageSrc(m[2])}
          alt={m[1]}
          draggable={false}
        />,
      );
    } else if (m[4] !== undefined) {
      // markdown link [label](url)
      parts.push(
        <ExternalLink key={key++} href={m[4]}>
          {renderInlineMarkdown(m[3])}
        </ExternalLink>,
      );
    } else if (m[5] !== undefined) {
      // wikilink — clickable, navigates and leaves the show
      const target = m[5].trim();
      const label = (m[6] ?? m[5]).trim();
      parts.push(
        <span
          key={key++}
          className="cm-wikilink"
          role="link"
          tabIndex={0}
          onClick={() => followWikilink(target)}
          title={target === label ? target : `${label} → ${target}`}
        >
          {label}
        </span>,
      );
    } else if (m[7] !== undefined) {
      // bare URL — trim trailing punctuation the way the editor does
      let url = m[7];
      let trailing = '';
      while (url.length && /[.,;:!?]$/.test(url)) {
        trailing = url[url.length - 1] + trailing;
        url = url.slice(0, -1);
      }
      parts.push(
        <ExternalLink key={key++} href={url}>
          {url}
        </ExternalLink>,
      );
      if (trailing) parts.push(<Fragment key={key++}>{trailing}</Fragment>);
    } else {
      // inline math
      const { html, error } = renderKatex(m[8], false);
      if (error) {
        parts.push(
          <Fragment key={key++}>{renderInlineMarkdown(m[0])}</Fragment>,
        );
      } else {
        parts.push(
          <span key={key++} dangerouslySetInnerHTML={{ __html: html }} />,
        );
      }
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
        <div key={key++} className="slide-table-wrap">
          <table>
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
          </table>
        </div>,
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

export function SlideView({
  slide,
  fontScale = 1,
}: {
  slide: Slide;
  fontScale?: number;
}) {
  // `.prose-mycel` hard-codes `font-size: 16px`, so the only reliable way to
  // scale the slide live is to set the base size inline on the prose root —
  // inline styles win over the stylesheet, and every child sizes in `em`.
  return (
    <div className="prose-mycel" style={{ fontSize: `${16 * fontScale}px`, maxWidth: 'none' }}>
      {renderSlideMarkdown(slide.md)}
    </div>
  );
}
