import { useCallback, useEffect, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import {
  ArrowRight,
  BookOpen,
  Briefcase,
  FolderOpen,
  GitBranch,
  GraduationCap,
  Layers,
  Plus,
  User,
  X,
  type LucideIcon,
} from 'lucide-react';
import { clsx } from 'clsx';
import { useVaultStore } from '@/stores/vault';
import { useRecentVaults, vaultDisplayName } from '@/stores/recentVaults';
import { LivingCanvas } from '@/components/fx/LivingCanvas';
import { useSporeMotion } from '@/hooks/useSporeMotion';
import { Logo } from '@/components/brand/Logo';
import { CloneVaultDialog } from '@/components/sync/CloneVaultDialog';

/** A glyph for a vault card, guessed from its name. */
function vaultIcon(name: string): LucideIcon {
  const n = name.toLowerCase();
  if (/research|lab|science|papers?/.test(n)) return Layers;
  if (/personal|life|home|journal|diary|me\b/.test(n)) return User;
  if (/work|job|company|team|project/.test(n)) return Briefcase;
  if (/study|school|uni|course|learn/.test(n)) return GraduationCap;
  return BookOpen;
}

/** `/Users/me/Documents/Notes` → `~/Documents` (the folder it lives in). */
function vaultLocation(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  parts.pop();
  const home = parts.findIndex((p, i) => (p === 'Users' || p === 'home') && i === 0);
  const tail = home === 0 ? ['~', ...parts.slice(2)] : parts;
  const shown = tail.length > 3 ? ['…', ...tail.slice(-2)] : tail;
  return shown.join('/') || '/';
}

export function VaultPicker() {
  const { openVault } = useVaultStore();
  const recents = useRecentVaults((s) => s.recents);
  const lastOpened = useRecentVaults((s) => s.lastOpened);
  const removeRecent = useRecentVaults((s) => s.remove);
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cloneOpen, setCloneOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const sporeMotion = useSporeMotion();

  // Keep a valid selection: the last vault opened, else the first recent.
  useEffect(() => {
    if (selected && recents.includes(selected)) return;
    setSelected(lastOpened && recents.includes(lastOpened) ? lastOpened : recents[0] ?? null);
  }, [recents, lastOpened, selected]);

  const handleOpen = useCallback(
    async (path: string) => {
      try {
        setLoading(path);
        setError(null);
        await openVault(path);
      } catch (e) {
        setError(String(e));
        // If the folder is gone, forget it.
        removeRecent(path);
      } finally {
        setLoading(null);
      }
    },
    [openVault, removeRecent],
  );

  const handlePickFolder = useCallback(async () => {
    try {
      const picked = await open({ directory: true, multiple: false });
      if (!picked) return;
      await handleOpen(picked as string);
    } catch (e) {
      setError(String(e));
    }
  }, [handleOpen]);

  const openSelected = () => {
    if (selected) void handleOpen(selected);
    else void handlePickFolder();
  };

  // Arrow keys walk the cards, Enter opens.
  const onGridKey = (e: KeyboardEvent) => {
    if (!recents.length) return;
    const i = Math.max(0, recents.indexOf(selected ?? ''));
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (step) {
      e.preventDefault();
      const next = recents[(i + step + recents.length) % recents.length];
      setSelected(next);
      document.getElementById(cardId(next))?.focus();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      openSelected();
    }
  };

  const busy = loading !== null;

  return (
    <div className="relative h-full overflow-hidden bg-surface-1">
      <LivingCanvas still={!sporeMotion} />
      <div className="myc-canvas-veil" />

      <div className="relative z-10 flex flex-col items-center justify-center h-full gap-4 px-6 py-10 overflow-y-auto pointer-events-none">
        <section className="myc-glass pointer-events-auto w-full max-w-[680px] rounded-[28px] p-7 sm:p-8 flex flex-col gap-6">
          <header className="flex items-start justify-between gap-4">
            <div className="flex flex-col gap-2 min-w-0">
              <span className="flex items-center gap-1.5 text-accent text-sm">
                <Logo size={15} />
                <span className="text-text-primary font-medium">Mycel</span>
              </span>
              <h1 className="text-[34px] leading-tight font-medium tracking-tight text-text-primary">
                Choose a vault
              </h1>
              <p className="text-sm text-text-secondary leading-relaxed">
                Your knowledge, on this device.
                <br />
                Private, fast, and always with you.
              </p>
            </div>
            <div className="hidden sm:flex items-center gap-2 shrink-0 text-[11px] text-text-muted">
              On this device <span className="myc-chip text-text-primary">Local</span>
            </div>
          </header>

          {recents.length > 0 && (
            <div className="flex flex-col gap-2">
              <span className="text-xs text-text-muted">Recent vaults</span>
              <div
                role="listbox"
                aria-label="Recent vaults"
                onKeyDown={onGridKey}
                className="grid grid-cols-2 sm:grid-cols-3 gap-3 max-h-[296px] overflow-y-auto p-1 -m-1"
              >
                {recents.map((path, i) => {
                  const name = vaultDisplayName(path);
                  const Icon = vaultIcon(name);
                  const isSel = path === selected;
                  const isLoading = loading === path;
                  return (
                    <div
                      key={path}
                      id={cardId(path)}
                      role="option"
                      aria-selected={isSel}
                      tabIndex={isSel ? 0 : -1}
                      title={path}
                      onClick={() => setSelected(path)}
                      onDoubleClick={() => void handleOpen(path)}
                      className={clsx(
                        'group relative h-[132px] rounded-2xl p-4 flex flex-col justify-end overflow-hidden cursor-pointer outline-none transition-[box-shadow,background-color,border-color]',
                        isSel
                          ? 'myc-selected'
                          : 'myc-pane hover:border-accent/40 focus-visible:border-accent/60',
                      )}
                    >
                      <CardGlow index={i} lit={isSel} />

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          removeRecent(path);
                        }}
                        className="absolute top-2 right-2 p-1 rounded-md opacity-0 group-hover:opacity-100 focus-visible:opacity-100 text-text-muted hover:text-error hover:bg-error/15 transition-opacity"
                        title="Remove from recents"
                        aria-label={`Remove ${name} from recents`}
                      >
                        <X size={12} />
                      </button>

                      <Icon
                        size={20}
                        strokeWidth={1.6}
                        className={clsx('relative mb-auto', isSel ? 'text-text-primary' : 'text-text-secondary')}
                      />

                      <div className="relative flex items-end justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-text-primary truncate">
                            {isLoading ? 'Opening…' : name}
                          </div>
                          <div className="text-[11px] text-text-muted truncate">
                            {vaultLocation(path)}
                          </div>
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleOpen(path);
                          }}
                          disabled={busy}
                          aria-label={`Open ${name}`}
                          className={clsx(
                            'shrink-0 grid place-items-center w-7 h-7 rounded-full transition-all',
                            isSel
                              ? 'bg-accent text-surface-0 shadow-glow-sm'
                              : 'border border-border-strong text-text-secondary group-hover:text-text-primary group-hover:border-accent/50',
                          )}
                        >
                          <ArrowRight size={14} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              onClick={openSelected}
              disabled={busy}
              className="myc-btn myc-btn-primary h-11 px-5 text-sm"
            >
              <FolderOpen size={16} />
              {recents.length > 0 ? 'Open vault' : 'Open or create a vault'}
              <ArrowRight size={16} className="ml-1" />
            </button>
            <button
              onClick={recents.length > 0 ? handlePickFolder : () => setCloneOpen(true)}
              disabled={busy}
              className="myc-btn myc-btn-secondary h-11 px-5 text-sm"
              title={recents.length > 0 ? 'Pick any folder — an empty one becomes a new vault' : undefined}
            >
              {recents.length > 0 ? (
                <>
                  <Plus size={16} /> Create vault
                </>
              ) : (
                <>
                  <GitBranch size={15} /> Clone from GitHub
                </>
              )}
            </button>
          </div>

          {error && <p className="text-error text-sm">{error}</p>}

          <footer className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-xs text-text-muted">
            <span className="leading-relaxed">
              Notes stay plain <code className="font-mono">.md</code> files; Mycel keeps its index in{' '}
              <code className="font-mono text-accent-muted">.mycel/</code>.
            </span>
            {recents.length > 0 && (
              <button
                onClick={() => setCloneOpen(true)}
                disabled={busy}
                className="flex items-center gap-1.5 hover:text-text-primary transition-colors"
              >
                <GitBranch size={12} /> Clone from GitHub
              </button>
            )}
          </footer>
        </section>

        {recents.length > 0 && (
          <span className="flex items-center gap-2 text-[11px] text-text-muted">
            <kbd className="myc-kbd">←→</kbd> choose <kbd className="myc-kbd">↵</kbd> open
          </span>
        )}
      </div>

      {cloneOpen && <CloneVaultDialog onClose={() => setCloneOpen(false)} />}
    </div>
  );
}

function cardId(path: string): string {
  return `vault-card-${encodeURIComponent(path)}`;
}

/** Soft organic light inside a card — a hint of the canvas behind it. */
const GLOWS = [
  'radial-gradient(circle at 78% 22%, var(--g) 0 18%, transparent 46%), radial-gradient(circle at 30% 0%, var(--g) 0 10%, transparent 34%)',
  'radial-gradient(circle at 85% 70%, var(--g) 0 14%, transparent 42%), radial-gradient(circle at 55% 12%, var(--g) 0 9%, transparent 30%)',
  'radial-gradient(circle at 18% 18%, var(--g) 0 12%, transparent 38%), radial-gradient(circle at 92% 40%, var(--g) 0 16%, transparent 44%)',
];

function CardGlow({ index, lit }: { index: number; lit: boolean }) {
  return (
    <span
      aria-hidden="true"
      className="absolute inset-0 pointer-events-none transition-opacity duration-300"
      style={
        {
          '--g': `color-mix(in srgb, var(--color-accent) ${lit ? 30 : 14}%, transparent)`,
          background: GLOWS[index % GLOWS.length],
          filter: 'blur(6px)',
        } as CSSProperties
      }
    />
  );
}
