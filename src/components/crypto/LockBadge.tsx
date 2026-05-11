import { useEffect, useState } from 'react';
import { Lock, LockOpen, Shield, KeyRound, X } from 'lucide-react';
import { clsx } from 'clsx';
import { useCryptoStore } from '@/stores/crypto';
import { useVaultStore } from '@/stores/vault';
import { confirm } from '@tauri-apps/plugin-dialog';

/**
 * Pill in the top toolbar that shows the vault's crypto state and lets the
 * user set up / unlock / lock / manage recipients.
 *
 * Three visual states:
 *   * **Off** (no identity yet): subtle shield icon, click to set up.
 *   * **Locked** (identity exists, no key in memory): yellow lock, click to
 *     unlock (the OS keyring will prompt for biometrics on supported HW).
 *   * **Unlocked**: green open lock, click opens the management panel.
 */
export function LockBadge() {
  const status = useCryptoStore((s) => s.status);
  const busy = useCryptoStore((s) => s.busy);
  const error = useCryptoStore((s) => s.error);
  const vaultRoot = useVaultStore((s) => s.vaultRoot);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (vaultRoot) void useCryptoStore.getState().refresh();
  }, [vaultRoot]);

  if (!vaultRoot) return null;

  let icon = <Shield size={14} />;
  let label = 'Encryption: off';
  let tone = 'text-text-muted hover:text-text-primary';
  if (status?.configured) {
    if (status.unlocked) {
      icon = <LockOpen size={14} />;
      label = 'Encryption: unlocked';
      tone = 'text-accent hover:text-accent';
    } else {
      icon = <Lock size={14} />;
      label = 'Encryption: locked';
      tone = 'text-warning hover:text-warning';
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        disabled={busy}
        className={clsx(
          'p-1.5 rounded hover:bg-surface-hover transition-colors',
          tone,
          busy && 'opacity-60 cursor-wait',
        )}
        title={label}
      >
        {icon}
      </button>

      {open && (
        <CryptoPanel onClose={() => setOpen(false)} error={error} />
      )}
    </>
  );
}

function CryptoPanel({ onClose, error }: { onClose: () => void; error: string | null }) {
  const status = useCryptoStore((s) => s.status);
  const busy = useCryptoStore((s) => s.busy);
  const setup = useCryptoStore((s) => s.setup);
  const unlock = useCryptoStore((s) => s.unlock);
  const lock = useCryptoStore((s) => s.lock);
  const reset = useCryptoStore((s) => s.reset);
  const addRecipient = useCryptoStore((s) => s.addRecipient);
  const removeRecipient = useCryptoStore((s) => s.removeRecipient);
  const listRecipients = useCryptoStore((s) => s.listRecipients);
  const [recipients, setRecipients] = useState<string[]>([]);
  const [newRecipient, setNewRecipient] = useState('');

  useEffect(() => {
    if (status?.configured) {
      listRecipients().then(setRecipients).catch(() => undefined);
    }
  }, [status?.configured, status?.recipients, listRecipients]);

  const isConfigured = !!status?.configured;
  const primary = status?.primary_recipient ?? null;

  return (
    <div
      className="fixed inset-0 z-40 bg-black/30 flex items-start justify-center pt-20"
      onClick={onClose}
    >
      <div
        className="bg-surface-1 border border-border rounded-lg shadow-xl w-full max-w-md p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-text-primary flex items-center gap-2">
            <Shield size={14} className="text-accent" />
            Encrypted notes
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-surface-hover text-text-muted"
            title="Close"
          >
            <X size={14} />
          </button>
        </div>

        {!isConfigured && (
          <div className="space-y-3">
            <p className="text-xs text-text-secondary leading-relaxed">
              Generate an X25519 identity for this vault. The wrap secret is
              stored in your OS keyring (hardware-backed on macOS Keychain
              and Windows Credential Manager). Encrypted notes are saved as
              <code className="mx-1 px-1 bg-surface-2 rounded">.md.age</code>
              files and sync as opaque blobs through GitHub.
            </p>
            <button
              onClick={() => {
                setup().catch(() => undefined);
              }}
              disabled={busy}
              className="w-full py-1.5 rounded bg-accent text-surface-0 text-sm font-medium hover:bg-accent-deep disabled:opacity-50"
            >
              {busy ? 'Generating identity…' : 'Set up encryption'}
            </button>
          </div>
        )}

        {isConfigured && (
          <div className="space-y-3">
            <div className="text-xs space-y-1">
              <Row label="Status">
                {status?.unlocked ? (
                  <span className="text-accent">unlocked</span>
                ) : (
                  <span className="text-warning">locked</span>
                )}
              </Row>
              <Row label="Recipients">{status?.recipients ?? 0}</Row>
              {primary && (
                <Row label="Public key">
                  <code className="text-[10px] break-all">{primary}</code>
                </Row>
              )}
              <Row label="Keyring">
                {status?.keyring_present ? (
                  <span className="text-accent">present</span>
                ) : (
                  <span className="text-error">missing</span>
                )}
              </Row>
            </div>

            <div className="flex gap-2">
              {status?.unlocked ? (
                <button
                  onClick={() => lock().catch(() => undefined)}
                  disabled={busy}
                  className="flex-1 py-1.5 rounded border border-border text-text-primary text-sm hover:bg-surface-hover disabled:opacity-50"
                >
                  Lock
                </button>
              ) : (
                <button
                  onClick={() => unlock().catch(() => undefined)}
                  disabled={busy || !status?.keyring_present}
                  className="flex-1 py-1.5 rounded bg-accent text-surface-0 text-sm font-medium hover:bg-accent-deep disabled:opacity-50"
                >
                  {busy ? 'Unlocking…' : 'Unlock'}
                </button>
              )}
            </div>

            <details>
              <summary className="text-xs text-text-muted cursor-pointer select-none">
                <KeyRound size={11} className="inline mr-1 -mt-0.5" />
                Manage recipients ({recipients.length})
              </summary>
              <div className="mt-2 space-y-2">
                <p className="text-[11px] text-text-muted leading-relaxed">
                  Add another device's public key (or a recovery key) so
                  notes you encrypt now can also be decrypted there.
                </p>
                <div className="space-y-1">
                  {recipients.map((r) => (
                    <div
                      key={r}
                      className="flex items-center gap-1 text-[10px] font-mono p-1.5 bg-surface-2 rounded"
                    >
                      <span className="flex-1 break-all">{r}</span>
                      {r === primary ? (
                        <span className="px-1 bg-accent/20 text-accent rounded">
                          primary
                        </span>
                      ) : (
                        <button
                          onClick={() =>
                            removeRecipient(r).catch(() => undefined)
                          }
                          className="text-text-muted hover:text-error"
                          title="Remove recipient"
                        >
                          <X size={10} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                <div className="flex gap-1">
                  <input
                    value={newRecipient}
                    onChange={(e) => setNewRecipient(e.target.value)}
                    placeholder="age1…"
                    className="flex-1 px-2 py-1 text-[11px] bg-surface-0 border border-border rounded font-mono outline-none focus:border-accent"
                  />
                  <button
                    onClick={() =>
                      addRecipient(newRecipient.trim())
                        .then(() => setNewRecipient(''))
                        .catch(() => undefined)
                    }
                    disabled={busy || !newRecipient.trim()}
                    className="px-2 py-1 text-[11px] rounded border border-border hover:bg-surface-hover disabled:opacity-50"
                  >
                    Add
                  </button>
                </div>
              </div>
            </details>

            <details>
              <summary className="text-xs text-error cursor-pointer select-none">
                Danger zone
              </summary>
              <div className="mt-2 space-y-2">
                <p className="text-[11px] text-text-muted leading-relaxed">
                  Removes the identity and keyring secret. Existing
                  <code className="mx-1 px-1 bg-surface-2 rounded">.md.age</code>
                  files become unreadable unless another recipient still has
                  the key.
                </p>
                <button
                  onClick={async () => {
                    const ok = await confirm(
                      'This will delete the X25519 identity and wipe the keyring secret. Encrypted notes will become unreadable unless another recipient has the key. Continue?',
                      { title: 'Delete encryption identity', kind: 'warning' },
                    );
                    if (ok) reset().catch(() => undefined);
                  }}
                  className="w-full py-1 rounded border border-error/40 text-error text-xs hover:bg-error/10"
                >
                  Delete identity
                </button>
              </div>
            </details>
          </div>
        )}

        {error && (
          <p className="mt-3 text-xs text-error bg-error/10 p-2 rounded">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-text-muted w-20 shrink-0">{label}</span>
      <span className="flex-1 text-text-primary">{children}</span>
    </div>
  );
}
