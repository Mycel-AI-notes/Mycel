import { clsx } from 'clsx';

export function EnergyBadge({ energy }: { energy?: string | null }) {
  if (!energy) return null;
  const map: Record<string, string> = {
    'высокая': '🔴',
    'средняя': '🟡',
    'низкая': '🟢',
    high: '🔴',
    medium: '🟡',
    low: '🟢',
  };
  const dot = map[energy] ?? '⚪';
  return (
    <span className="text-[11px] text-text-muted whitespace-nowrap">
      {dot} {energy}
    </span>
  );
}

export function DurationBadge({ duration }: { duration?: string | null }) {
  if (!duration) return null;
  return (
    <span className="text-[11px] text-text-muted whitespace-nowrap">{duration}</span>
  );
}

export function ContextChip({
  context,
  selected,
  onClick,
}: {
  context: string;
  selected?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        'px-1.5 py-0.5 rounded text-[11px] border transition-colors',
        selected
          ? 'border-accent text-accent bg-accent/10'
          : 'border-border text-text-muted hover:bg-surface-hover',
      )}
    >
      {context}
    </button>
  );
}

export function ProjectChip({ name }: { name?: string | null }) {
  if (!name) return null;
  return (
    <span className="text-[11px] text-accent-deep whitespace-nowrap truncate max-w-[160px]">
      📋 {name}
    </span>
  );
}

export function PageLink({
  page,
  onOpen,
}: {
  page?: string | null;
  onOpen?: (path: string) => void;
}) {
  if (!page) return null;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onOpen?.(page);
      }}
      title={page}
      className="text-[11px] text-text-muted hover:text-accent inline-flex items-center gap-0.5"
    >
      📄 <span className="truncate max-w-[140px]">{page.split('/').pop()}</span>
    </button>
  );
}
