import type { CSSProperties } from 'react';
import { PAGE_ICONS, iconHue } from './page-icons';

interface Props {
  icon: string;
  color?: string | null;
  /** Glyph size in px. */
  size: number;
  /** Draw the soft tinted tile behind a line icon (page header, picker). */
  tile?: boolean;
  className?: string;
}

/** A page icon: a tinted line icon from the curated set, or an emoji / any
 *  other text verbatim (frontmatter written by another tool). */
export function PageIcon({ icon, color, size, tile, className }: Props) {
  const entry = PAGE_ICONS[icon];
  if (!entry) {
    return (
      <span
        className={`myc-page-icon-emoji ${className ?? ''}`}
        style={{ fontSize: size, lineHeight: 1 }}
        aria-hidden="true"
      >
        {icon}
      </span>
    );
  }
  const hue = iconHue(color);
  const style = (hue === null ? {} : { '--icon-hue': String(hue) }) as CSSProperties;
  const { Icon } = entry;
  return (
    <span
      className={`myc-page-icon ${tile ? 'is-tile' : ''} ${hue === null ? 'is-accent' : ''} ${className ?? ''}`}
      style={style}
      aria-hidden="true"
    >
      <Icon size={size} strokeWidth={tile ? 1.75 : 2} />
    </span>
  );
}
