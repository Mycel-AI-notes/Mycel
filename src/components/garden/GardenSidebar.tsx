import { useEffect, useState } from 'react';
import { clsx } from 'clsx';
import {
  ChevronDown,
  ChevronRight,
  Inbox,
  Zap,
  ClipboardList,
  Hourglass,
  Lightbulb,
  Sprout,
  Plus,
  HelpCircle,
} from 'lucide-react';
import { useGardenStore } from '@/stores/garden';
import { useVaultStore } from '@/stores/vault';
import type { GardenView } from '@/types/garden';
import { parseGardenTabPath } from '@/lib/garden-tab';
import { GardenHelp } from './GardenHelp';

interface RowProps {
  icon: React.ReactNode;
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
  warn?: boolean;
}

function Row({ icon, label, count, active, onClick, warn }: RowProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        'w-full flex items-center gap-2 px-2 py-1 text-sm rounded transition-colors',
        active
          ? 'bg-accent/12 text-accent'
          : 'text-text-secondary hover:bg-surface-hover',
      )}
    >
      <span className="w-3 h-3 shrink-0" />
      <span className="shrink-0 flex items-center justify-center w-4 h-4">
        {icon}
      </span>
      <span className="flex-1 text-left truncate">{label}</span>
      {count !== undefined && count > 0 && (
        <span
          className={clsx(
            'text-[11px] tabular-nums px-1.5 py-0.5 rounded',
            warn
              ? 'bg-error/15 text-error'
              : 'bg-surface-2 text-text-muted',
          )}
        >
          {count}
        </span>
      )}
    </button>
  );
}

export function GardenSidebar() {
  const {
    sectionOpen,
    toggleSection,
    counts,
    openCapture,
    refreshCounts,
  } = useGardenStore();
  const activeTabPath = useVaultStore((s) => s.activeTabPath);
  const openGardenTab = useVaultStore((s) => s.openGardenTab);
  const view = activeTabPath ? parseGardenTabPath(activeTabPath) : null;
  const [helpOpen, setHelpOpen] = useState(false);

  // Refresh counts whenever the section opens — cheap, keeps badges fresh
  // even after edits in views that don't touch them directly.
  useEffect(() => {
    if (sectionOpen) void refreshCounts();
  }, [sectionOpen, refreshCounts]);

  const isView = (kind: GardenView['kind']) => view?.kind === kind;

  return (
    <div className="border-b border-border bg-surface-0">
      <div className="flex items-center justify-between px-2 py-1.5">
        <button
          type="button"
          onClick={toggleSection}
          className="flex items-center gap-1 px-1 py-0.5 text-xs font-semibold uppercase tracking-wider text-text-muted hover:text-text-primary"
          title="Toggle Garden section"
        >
          {sectionOpen ? (
            <ChevronDown size={12} />
          ) : (
            <ChevronRight size={12} />
          )}
          <Sprout size={13} className="text-accent" />
          <span>Garden</span>
        </button>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => setHelpOpen(true)}
            className="p-1 rounded hover:bg-surface-hover text-text-muted hover:text-text-primary"
            title="How Garden works"
          >
            <HelpCircle size={14} />
          </button>
          <button
            type="button"
            onClick={openCapture}
            className="p-1 rounded hover:bg-surface-hover text-text-muted hover:text-text-primary"
            title="Quick capture (⌘I)"
          >
            <Plus size={14} />
          </button>
        </div>
      </div>

      {helpOpen && <GardenHelp onClose={() => setHelpOpen(false)} />}

      {sectionOpen && (
        <div className="px-1 pb-1 flex flex-col gap-0.5">
          <Row
            icon={<Inbox size={14} className="text-accent-deep" />}
            label="Inbox"
            count={counts.inbox}
            active={isView('inbox')}
            onClick={() => openGardenTab({ kind: 'inbox' }, { preview: true })}
            warn={counts.inbox > 0}
          />
          <Row
            icon={<Zap size={14} className="text-accent" />}
            label="Next Actions"
            count={counts.actions}
            active={isView('actions')}
            onClick={() => openGardenTab({ kind: 'actions' }, { preview: true })}
          />
          <Row
            icon={<ClipboardList size={14} className="text-accent-deep" />}
            label="Projects"
            count={counts.projects}
            active={isView('projects') || isView('project-detail')}
            onClick={() => openGardenTab({ kind: 'projects' }, { preview: true })}
          />
          <Row
            icon={<Hourglass size={14} className="text-text-muted" />}
            label="Waiting For"
            count={counts.waiting}
            active={isView('waiting')}
            onClick={() => openGardenTab({ kind: 'waiting' }, { preview: true })}
          />
          <Row
            icon={<Lightbulb size={14} className="text-text-muted" />}
            label="Someday"
            active={isView('someday')}
            onClick={() => openGardenTab({ kind: 'someday' }, { preview: true })}
          />
        </div>
      )}
    </div>
  );
}
