import { useEffect, useState } from 'react';
import { Lock, LockOpen, Shield, KeyRound, X, Eye, EyeOff } from 'lucide-react';
import { clsx } from 'clsx';
import { useCryptoStore, AUTO_LOCK_IDLE_MS } from '@/stores/crypto';
import { useVaultStore } from '@/stores/vault';
import { confirm } from '@tauri-apps/plugin-dialog';

/**
 * Pill in the top toolbar that surfaces the vault's encryption state and
 * is the *only* way to set up, unlock, or lock the vault.
 *
 * Three visual states:
 *   * **Off** (no identity yet): bare shield, click to open setup.
 *   * **Locked** (identity exists, no key in memory): yellow lock, click
 *     to open the unlock dialog (asks for the passphrase).
 *   * **Unlocked**: green open lock, click opens the management panel
 *     where you can Lock again or add recipients.
 */
export function LockBadge() {
  const status = useCryptoStore((s) => s.status);
  const busy = useCryptoStore((s) => s.busy);
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
      label = 'Encryption: locked — click to unlock';
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

      {open && <CryptoPanel onClose={() => setOpen(false)} />}
    </>
  );
}

// ---------------------------------------------------------------------------
// Modal panel — picks one of three views based on status
// ---------------------------------------------------------------------------

function CryptoPanel({ onClose }: { onClose: () => void }) {
  const status = useCryptoStore((s) => s.status);
  const error = useCryptoStore((s) => s.error);
  const clearError = useCryptoStore((s) => s.clearError);

  useEffect(() => {
    clearError();
  }, [clearError]);

  return (
    <div
      className="fixed inset-0 z-40 bg-black/40 flex items-start justify-center pt-20"
      onClick={onClose}
    >
      <div
        className="bg-surface-1 border border-border rounded-lg shadow-xl w-full max-w-md p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <Header onClose={onClose} />
        {!status?.configured ? (
          <SetupView onDone={onClose} />
        ) : !status.unlocked ? (
          <UnlockView onDone={onClose} />
        ) : (
          <ManageView />
        )}
        {error && (
          <p className="mt-3 text-xs text-error bg-error/10 p-2 rounded break-words">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

function Header({ onClose }: { onClose: () => void }) {
  return (
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
  );
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

function SetupView({ onDone }: { onDone: () => void }) {
  const setup = useCryptoStore((s) => s.setup);
  const busy = useCryptoStore((s) => s.busy);
  const [pass, setPass] = useState('');
  const [confirmPass, setConfirmPass] = useState('');
  const [show, setShow] = useState(false);
  const [warn, setWarn] = useState<string | null>(null);

  const canSubmit = pass.length >= 8 && pass === confirmPass && !busy;

  const submit = async () => {
    setWarn(null);
    if (pass.length < 8) {
      setWarn('Passphrase must be at least 8 characters.');
      return;
    }
    if (pass !== confirmPass) {
      setWarn('Passphrases don’t match.');
      return;
    }
    try {
      await setup(pass);
      onDone();
    } catch {
      // store sets error
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-text-secondary leading-relaxed">
        Generate an X25519 identity for this vault. The identity is wrapped
        twice: once with a random secret in your OS keyring (binds it to
        this device), and once with a passphrase that <strong>you</strong>{' '}
        choose — without that passphrase, nothing on this machine can
        decrypt your notes.
      </p>
      <p className="text-[11px] text-warning bg-warning/10 p-2 rounded leading-relaxed">
        <strong>Write the passphrase down.</strong> There is no recovery —
        if you forget it, encrypted notes are gone.
      </p>

      <PasswordField
        value={pass}
        onChange={setPass}
        show={show}
        onToggle={() => setShow((s) => !s)}
        placeholder="Passphrase (≥8 chars)"
        autoFocus
      />
      <PasswordField
        value={confirmPass}
        onChange={setConfirmPass}
        show={show}
        onToggle={() => setShow((s) => !s)}
        placeholder="Confirm passphrase"
        onEnter={canSubmit ? submit : undefined}
      />

      {warn && <p className="text-[11px] text-error">{warn}</p>}

      <button
        onClick={submit}
        disabled={!canSubmit}
        className="w-full py-1.5 rounded bg-accent text-surface-0 text-sm font-medium hover:bg-accent-deep disabled:opacity-50"
      >
        {busy ? 'Generating identity…' : 'Set up encryption'}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Unlock
// ---------------------------------------------------------------------------

function UnlockView({ onDone }: { onDone: () => void }) {
  const unlock = useCryptoStore((s) => s.unlock);
  const busy = useCryptoStore((s) => s.busy);
  const [pass, setPass] = useState('');
  const [show, setShow] = useState(false);

  const submit = async () => {
    if (!pass || busy) return;
    try {
      await unlock(pass);
      onDone();
    } catch {
      // store sets error — keep the dialog open so the user can retry
      setPass('');
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-text-secondary leading-relaxed">
        Enter the passphrase for this vault. The OS keyring already
        verified you, but the passphrase is the second factor — without
        it, this vault cannot be unlocked.
      </p>
      <PasswordField
        value={pass}
        onChange={setPass}
        show={show}
        onToggle={() => setShow((s) => !s)}
        placeholder="Passphrase"
        autoFocus
        onEnter={submit}
      />
      <button
        onClick={submit}
        disabled={!pass || busy}
        className="w-full py-1.5 rounded bg-accent text-surface-0 text-sm font-medium hover:bg-accent-deep disabled:opacity-50"
      >
        {busy ? 'Unlocking…' : 'Unlock'}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Manage (unlocked)
// ---------------------------------------------------------------------------

function ManageView() {
  const status = useCryptoStore((s) => s.status);
  const lock = useCryptoStore((s) => s.lock);
  const reset = useCryptoStore((s) => s.reset);
  const addRecipient = useCryptoStore((s) => s.addRecipient);
  const removeRecipient = useCryptoStore((s) => s.removeRecipient);
  const listRecipients = useCryptoStore((s) => s.listRecipients);
  const busy = useCryptoStore((s) => s.busy);
  const [recipients, setRecipients] = useState<string[]>([]);
  const [newRecipient, setNewRecipient] = useState('');
  const primary = status?.primary_recipient ?? null;
  const minutes = Math.round(AUTO_LOCK_IDLE_MS / 60_000);

  useEffect(() => {
    listRecipients().then(setRecipients).catch(() => undefined);
  }, [status?.recipients, listRecipients]);

  return (
    <div className="space-y-3">
      <div className="text-xs space-y-1">
        <Row label="Status">
          <span className="text-accent">unlocked</span>
        </Row>
        <Row label="Recipients">{status?.recipients ?? 0}</Row>
        {primary && (
          <Row label="Public key">
            <code className="text-[10px] break-all">{primary}</code>
          </Row>
        )}
        <Row label="Auto-lock">after {minutes} min idle</Row>
      </div>

      <button
        onClick={() => lock().catch(() => undefined)}
        disabled={busy}
        className="w-full py-1.5 rounded border border-border text-text-primary text-sm hover:bg-surface-hover disabled:opacity-50"
      >
        Lock now
      </button>

      <details>
        <summary className="text-xs text-text-muted cursor-pointer select-none">
          <KeyRound size={11} className="inline mr-1 -mt-0.5" />
          Manage recipients ({recipients.length})
        </summary>
        <div className="mt-2 space-y-2">
          <p className="text-[11px] text-text-muted leading-relaxed">
            Add another device&rsquo;s public key (or a paper recovery key)
            so notes you encrypt now can also be decrypted there.
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
                    onClick={() => removeRecipient(r).catch(() => undefined)}
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
            Removes the identity and keyring secret. Existing{' '}
            <code className="px-1 bg-surface-2 rounded">.md.age</code> files
            become unreadable unless another recipient still has the key.
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
  );
}

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-text-muted w-20 shrink-0">{label}</span>
      <span className="flex-1 text-text-primary">{children}</span>
    </div>
  );
}

function PasswordField(props: {
  value: string;
  onChange: (v: string) => void;
  show: boolean;
  onToggle: () => void;
  placeholder: string;
  autoFocus?: boolean;
  onEnter?: () => void;
}) {
  return (
    <div className="relative">
      <input
        type={props.show ? 'text' : 'password'}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        placeholder={props.placeholder}
        autoFocus={props.autoFocus}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && props.onEnter) {
            e.preventDefault();
            props.onEnter();
          }
        }}
        className="w-full px-2 py-1.5 pr-8 text-sm bg-surface-0 border border-border rounded outline-none focus:border-accent"
      />
      <button
        type="button"
        onClick={props.onToggle}
        className="absolute right-1 top-1/2 -translate-y-1/2 p-1 text-text-muted hover:text-text-primary"
        title={props.show ? 'Hide' : 'Show'}
      >
        {props.show ? <EyeOff size={12} /> : <Eye size={12} />}
      </button>
    </div>
  );
}
