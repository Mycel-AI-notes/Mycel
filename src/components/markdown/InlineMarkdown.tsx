import { Fragment, type ReactNode } from 'react';

type Token =
  | { kind: 'text'; value: string }
  | { kind: 'code'; value: string }
  | { kind: 'bold'; inner: string }
  | { kind: 'italic'; inner: string }
  | { kind: 'strike'; inner: string }
  | { kind: 'link'; label: string; href: string }
  | { kind: 'wikilink'; label: string; target: string };

interface PatternMatch {
  index: number;
  length: number;
  token: Exclude<Token, { kind: 'text' }>;
  priority: number;
}

const PATTERNS: Array<{
  re: RegExp;
  priority: number;
  build: (m: RegExpExecArray) => Exclude<Token, { kind: 'text' }>;
}> = [
  {
    re: /`([^`\n]+)`/g,
    priority: 0,
    build: (m) => ({ kind: 'code', value: m[1] }),
  },
  {
    re: /\[\[([^\]|\n]+)(?:\|([^\]\n]+))?\]\]/g,
    priority: 1,
    build: (m) => ({
      kind: 'wikilink',
      label: (m[2] ?? m[1]).trim(),
      target: m[1].trim(),
    }),
  },
  {
    re: /\[([^\]\n]+)\]\(([^)\s]+)\)/g,
    priority: 2,
    build: (m) => ({ kind: 'link', label: m[1], href: m[2] }),
  },
  {
    re: /\*\*([^\n*][^\n]*?)\*\*/g,
    priority: 3,
    build: (m) => ({ kind: 'bold', inner: m[1] }),
  },
  {
    re: /~~([^\n]+?)~~/g,
    priority: 4,
    build: (m) => ({ kind: 'strike', inner: m[1] }),
  },
  {
    re: /(?<![*\w])\*(?!\*)([^\n*]+?)\*(?![*\w])/g,
    priority: 5,
    build: (m) => ({ kind: 'italic', inner: m[1] }),
  },
];

function nextMatch(text: string, from: number): PatternMatch | null {
  let best: PatternMatch | null = null;
  for (const { re, priority, build } of PATTERNS) {
    re.lastIndex = from;
    const m = re.exec(text);
    if (!m) continue;
    if (
      best === null ||
      m.index < best.index ||
      (m.index === best.index && priority < best.priority)
    ) {
      best = {
        index: m.index,
        length: m[0].length,
        token: build(m),
        priority,
      };
    }
  }
  return best;
}

function tokenize(text: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < text.length) {
    const m = nextMatch(text, i);
    if (!m) {
      out.push({ kind: 'text', value: text.slice(i) });
      break;
    }
    if (m.index > i) {
      out.push({ kind: 'text', value: text.slice(i, m.index) });
    }
    out.push(m.token);
    i = m.index + m.length;
  }
  return out;
}

function renderToken(t: Token, key: number): ReactNode {
  switch (t.kind) {
    case 'text':
      return <Fragment key={key}>{t.value}</Fragment>;
    case 'code':
      return (
        <code key={key} className="cm-md-code">
          {t.value}
        </code>
      );
    case 'bold':
      return (
        <strong key={key} className="cm-md-bold">
          {renderInlineMarkdown(t.inner)}
        </strong>
      );
    case 'italic':
      return (
        <em key={key} className="cm-md-italic">
          {renderInlineMarkdown(t.inner)}
        </em>
      );
    case 'strike':
      return (
        <s key={key} className="cm-md-strike">
          {renderInlineMarkdown(t.inner)}
        </s>
      );
    case 'link':
      return (
        <a
          key={key}
          className="cm-md-link"
          href={t.href}
          title={t.href}
          target="_blank"
          rel="noopener noreferrer"
          onMouseDown={(e) => e.stopPropagation()}
        >
          {renderInlineMarkdown(t.label)}
        </a>
      );
    case 'wikilink':
      return (
        <span
          key={key}
          className="cm-wikilink"
          title={t.target === t.label ? t.target : `${t.label} → ${t.target}`}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {t.label}
        </span>
      );
  }
}

export function renderInlineMarkdown(text: string): ReactNode {
  if (!text) return null;
  return tokenize(text).map(renderToken);
}

export function InlineMarkdown({ text }: { text: string }) {
  return <>{renderInlineMarkdown(text)}</>;
}
