import { clsx } from 'clsx';

interface LogoProps {
  size?: number;
  className?: string;
  withWordmark?: boolean;
}

/**
 * Mycel mark — a stylized hypha tracing an "M" with three spore-nodes
 * at its branch points. Uses currentColor so it inherits accent / muted
 * tones from the parent.
 */
export function Logo({ size = 18, className, withWordmark = false }: LogoProps) {
  return (
    <span className={clsx('inline-flex items-center gap-1.5 select-none', className)}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
        className="shrink-0"
      >
        {/* hypha — wavy stroke connecting the three spore points */}
        <path
          d="M3 19 C 3 12, 5 6, 8 6 C 11 6, 11.5 12, 12 14 C 12.5 16, 13 22, 16 22 C 19 22, 21 16, 21 6"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          fill="none"
          opacity="0.85"
        />
        {/* terminal spore (top-left) */}
        <circle cx="8" cy="6" r="1.7" fill="currentColor" />
        {/* central spore (lower waist of the M) */}
        <circle cx="12" cy="14" r="2" fill="currentColor" />
        {/* terminal spore (top-right) */}
        <circle cx="21" cy="6" r="1.7" fill="currentColor" />
        {/* tiny secondary spore — the "branching" tell */}
        <circle cx="3" cy="19" r="1.1" fill="currentColor" opacity="0.7" />
      </svg>
      {withWordmark && (
        <span className="font-semibold tracking-wide text-[13px] leading-none">mycel</span>
      )}
    </span>
  );
}
