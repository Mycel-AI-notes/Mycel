import { useEffect, useState } from 'react';
import { Lock, LockOpen, Shield, KeyRound, X, Eye, EyeOff, Loader2, Check } from 'lucide-react';
import { clsx } from 'clsx';
import {
  useCryptoStore,
  AUTO_LOCK_IDLE_MS,
  type UnlockStage,
  type SetupStage,
  type LockStage,
} from '@/stores/crypto';
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
  const open = useCryptoStore((s) => s.panelOpen);
  const openPanel = useCryptoStore((s) => s.openPanel);
  const closePanel = useCryptoStore((s) => s.closePanel);
  const vaultRoot = useVaultStore((s) => s.vaultRoot);

  useEffect(() => {
    if (vaultRoot) void useCryptoStore.getState().refresh();
  }, [vaultRoot]);

  if (!vaultRoot) return null;

  // Colour scheme is security-state, not friendliness:
  //   * Red    — encryption not configured / unusable on this device.
  //              Notes are stored in cleartext, this needs attention.
  //   * Yellow — vault is unlocked. Secrets are loaded into memory and
  //              tabs are decrypted; not a danger, but not "at rest"
  //              either, so a caution colour.
  //   * Green  — vault is locked. Everything is encrypted on disk and
  //              the key isn't in memory. Safest state.
  let icon = <Shield size={14} />;
  let label = 'Encryption: off';
  let tone = 'text-error hover:text-error';
  if (status?.configured) {
    if (!status.local_identity_present) {
      // Vault was set up on another device; this one hasn't joined yet,
      // so from here it's effectively "no encryption available".
      icon = <Shield size={14} />;
      label = 'This device has not joined the vault — click to set up';
      tone = 'text-error hover:text-error';
    } else if (status.unlocked) {
      icon = <LockOpen size={14} />;
      if (status.has_passphrase) {
        label = 'Encryption: unlocked';
      } else {
        label = 'Encryption: unlocked (no passphrase — Lock is decorative)';
      }
      tone = 'text-warning hover:text-warning';
    } else {
      icon = <Lock size={14} />;
      label = 'Encryption: locked — click to unlock';
      tone = 'text-accent hover:text-accent';
    }
  }

  return (
    <>
      <button
        onClick={openPanel}
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

      {open && <CryptoPanel onClose={closePanel} />}
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
  const lockStage = useCryptoStore((s) => s.lockStage);

  useEffect(() => {
    clearError();
  }, [clearError]);

  return (
    <div
      className="fixed inset-0 z-40 bg-black/40 flex items-center justify-center"
      onClick={onClose}
    >
      <div
        className="bg-surface-1 border border-border rounded-lg shadow-xl w-full max-w-md p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <Header onClose={onClose} />
        {lockStage != null ? (
          // The lock flow updates the status mid-flight (unlocked → false
          // before the final stage finishes), which would otherwise flip
          // the panel to UnlockView while the animation is still running.
          // Short-circuit on `lockStage` so the user sees the whole
          // sequence end-to-end.
          <LockingProgress />
        ) : !status?.configured ? (
          <SetupView onDone={onClose} mode="fresh" />
        ) : !status.local_identity_present ? (
          <SetupView onDone={onClose} mode="join" />
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

function SetupView({
  onDone,
  mode,
}: {
  onDone: () => void;
  mode: 'fresh' | 'join';
}) {
  const setup = useCryptoStore((s) => s.setup);
  const busy = useCryptoStore((s) => s.busy);
  const [usePassphrase, setUsePassphrase] = useState(true);
  const [pass, setPass] = useState('');
  const [confirmPass, setConfirmPass] = useState('');
  const [show, setShow] = useState(false);
  const [warn, setWarn] = useState<string | null>(null);

  const canSubmit = usePassphrase
    ? pass.length >= 8 && pass === confirmPass && !busy
    : !busy;

  const submit = async () => {
    setWarn(null);
    if (usePassphrase) {
      if (pass.length < 8) {
        setWarn('Passphrase must be at least 8 characters.');
        return;
      }
      if (pass !== confirmPass) {
        setWarn('Passphrases don’t match.');
        return;
      }
    }
    try {
      await setup(usePassphrase ? pass : '');
      onDone();
    } catch {
      // store sets error
    }
  };

  // Same pattern as UnlockView: while the backend is wrapping the new
  // identity (two scrypt passes), swap the form for a step-by-step
  // progress checklist instead of just dimming the button.
  if (busy) return <SetupProgress hasPassphrase={usePassphrase} mode={mode} />;

  return (
    <div className="space-y-3">
      {mode === 'join' ? (
        <>
          <p className="text-xs text-text-secondary leading-relaxed">
            This vault was set up on another device. Generate a new
            identity for <strong>this</strong> device — its public key
            will be added to{' '}
            <code className="px-1 bg-surface-2 rounded">recipients.txt</code>{' '}
            so notes you encrypt here are readable on both machines.
          </p>
          <p className="text-[11px] text-text-muted bg-surface-2 p-2 rounded leading-relaxed">
            Existing <code className="px-1 bg-surface-2 rounded">.md.age</code>{' '}
            notes (created before this device joined) will NOT be readable
            here until the original device runs{' '}
            <strong>Re-encrypt all to current recipients</strong> and
            pushes. Your own passphrase is independent of theirs — it
            only protects unlock on this device.
          </p>
        </>
      ) : (
        <p className="text-xs text-text-secondary leading-relaxed">
          Generate an X25519 identity for this vault. The identity is wrapped
          with a random secret in your OS keyring (binds it to this device).
          Optionally, add a passphrase as a second factor — without it,
          anyone with this device can re-unlock the vault by clicking Unlock,
          because the OS keyring hands the wrap secret back silently.
        </p>
      )}

      <label className="flex items-start gap-2 text-xs cursor-pointer">
        <input
          type="checkbox"
          checked={usePassphrase}
          onChange={(e) => setUsePassphrase(e.target.checked)}
          className="mt-0.5"
        />
        <span>
          <span className="text-text-primary">Protect with a passphrase</span>{' '}
          <span className="text-text-muted">
            (recommended — makes Lock actually deny access)
          </span>
        </span>
      </label>

      {usePassphrase ? (
        <>
          <p className="text-[11px] text-warning bg-warning/10 p-2 rounded leading-relaxed">
            <strong>Write the passphrase down.</strong> There is no recovery
            — if you forget it, encrypted notes are gone.
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
        </>
      ) : (
        <p className="text-[11px] text-warning bg-warning/10 p-2 rounded leading-relaxed">
          Without a passphrase, encrypted notes still survive a leak of the
          vault folder, but anyone with access to <em>this</em> machine can
          re-unlock the vault in one click. You can add a passphrase later.
        </p>
      )}

      <button
        onClick={submit}
        disabled={!canSubmit}
        className="w-full py-1.5 rounded bg-accent text-surface-0 text-sm font-medium hover:bg-accent-deep disabled:opacity-50"
      >
        {mode === 'join' ? 'Join this device' : 'Set up encryption'}
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
  const hasPassphrase = useCryptoStore(
    (s) => s.status?.has_passphrase ?? false,
  );
  const [pass, setPass] = useState('');
  const [show, setShow] = useState(false);

  const submit = async () => {
    if (busy) return;
    if (hasPassphrase && !pass) return;
    try {
      await unlock(hasPassphrase ? pass : '');
      onDone();
    } catch {
      // store sets error — keep the dialog open so the user can retry
      setPass('');
    }
  };

  // While the backend is running scrypt, swap the form for a clear
  // progress panel that explains why it's slow. Otherwise users see a
  // dimmed button for 1–3s and assume the app hung.
  if (busy) return <UnlockingProgress />;

  if (!hasPassphrase) {
    return (
      <div className="space-y-3">
        <p className="text-xs text-text-secondary leading-relaxed">
          This vault is unlocked with the OS keyring only — no passphrase
          was set. Click Unlock to load the X25519 secret into memory.
        </p>
        <p className="text-[11px] text-warning bg-warning/10 p-2 rounded leading-relaxed">
          Heads up: anyone with access to this device can also click
          Unlock. Open the panel after unlocking to <em>Set a passphrase</em>
          {' '}if you want Lock to actually deny access.
        </p>
        <button
          onClick={submit}
          className="w-full py-1.5 rounded bg-accent text-surface-0 text-sm font-medium hover:bg-accent-deep"
        >
          Unlock
        </button>
      </div>
    );
  }

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
        disabled={!pass}
        className="w-full py-1.5 rounded bg-accent text-surface-0 text-sm font-medium hover:bg-accent-deep disabled:opacity-50"
      >
        Unlock
      </button>
    </div>
  );
}

/**
 * Tiny renderer for the unlock/setup progress checklist. Both flows have
 * a list of stages each in one of three states (pending, current, done)
 * with a one-line hint shown on the current step. This keeps the two
 * progress panels visually identical without duplicating layout.
 */
function StageList<S extends string>({
  stages,
  currentIdx,
  labels,
}: {
  stages: S[];
  currentIdx: number;
  labels: Record<S, { title: string; hint: string }>;
}) {
  return (
    <ol className="space-y-1.5 text-[11px]">
      {stages.map((s, idx) => {
        const state =
          currentIdx === -1 || idx > currentIdx
            ? 'pending'
            : idx === currentIdx
              ? 'current'
              : 'done';
        const { title, hint } = labels[s];
        return (
          <li key={s} className="flex gap-2 items-start">
            <span className="mt-0.5 w-3 shrink-0 flex items-center justify-center">
              {state === 'done' && <Check size={11} className="text-accent" />}
              {state === 'current' && (
                <Loader2 size={11} className="animate-spin text-accent" />
              )}
              {state === 'pending' && (
                <span className="w-1 h-1 rounded-full bg-text-muted/40" />
              )}
            </span>
            <span className="flex-1 leading-relaxed">
              <span
                className={clsx(
                  state === 'pending' && 'text-text-muted',
                  state === 'current' && 'text-text-primary font-medium',
                  state === 'done' && 'text-text-secondary',
                )}
              >
                {title}
              </span>
              {state === 'current' && (
                <span className="block text-text-muted">{hint}</span>
              )}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Real (not faked) step-by-step progress for the unlock flow. The Rust
 * backend emits a `crypto:unlock-stage` event between major steps and
 * the store mirrors it into `unlockStage`. We walk through the four
 * possible stages in order, showing each as either "current" (spinner),
 * "done" (check), or "pending" (dim) so the user can see what's
 * happening and roughly how far we are.
 */
const STAGE_ORDER: Exclude<UnlockStage, null>[] = [
  'keyring',
  'outer',
  'passphrase',
  'identity',
  'refresh',
];

const STAGE_LABELS: Record<Exclude<UnlockStage, null>, { title: string; hint: string }> = {
  keyring: {
    title: 'Reading wrap secret from the OS keyring',
    hint: 'Asks the OS keychain for the device-bound secret that wraps your identity.',
  },
  outer: {
    title: 'Unwrapping the device key',
    hint: 'Running scrypt on the keyring secret. Slow on purpose — this is the cost an attacker would pay per guess if they stole the vault.',
  },
  passphrase: {
    title: 'Verifying your passphrase',
    hint: 'Running scrypt on what you typed. Same story: slow by design so brute-forcing the passphrase offline is unaffordable.',
  },
  identity: {
    title: 'Loading your X25519 identity',
    hint: 'Parsing the decrypted age secret key into memory so notes can be decrypted on demand.',
  },
  refresh: {
    title: 'Refreshing vault status',
    hint: 'Picking up the new unlocked state so the UI knows the vault is open.',
  },
};

function UnlockingProgress() {
  const stage = useCryptoStore((s) => s.unlockStage);
  const hasPassphrase = useCryptoStore((s) => s.status?.has_passphrase ?? false);

  // The `passphrase` step is only emitted when the vault is double-wrapped.
  // Hide it from the list otherwise so single-wrap users don't see a step
  // that will never be visited.
  const stages = STAGE_ORDER.filter((s) => s !== 'passphrase' || hasPassphrase);
  const currentIdx = stage == null ? -1 : stages.indexOf(stage);

  return (
    <div
      className="space-y-3 py-2"
      role="status"
      aria-live="polite"
      aria-label="Unlocking vault"
    >
      <div className="flex items-center justify-center gap-2">
        <Shield size={20} className="text-accent" />
        <span className="text-sm font-medium text-text-primary">
          Unlocking your vault…
        </span>
      </div>
      <StageList stages={stages} currentIdx={currentIdx} labels={STAGE_LABELS} />
    </div>
  );
}

const SETUP_STAGE_ORDER: Exclude<SetupStage, null>[] = [
  'keypair',
  'wrap-passphrase',
  'wrap-keyring',
  'store',
  'refresh',
];

const SETUP_STAGE_LABELS: Record<
  Exclude<SetupStage, null>,
  { title: string; hint: string }
> = {
  keypair: {
    title: 'Generating your X25519 keypair',
    hint: 'A fresh public/private key pair for this device. The public key goes into recipients.txt, the private key stays wrapped on disk.',
  },
  'wrap-passphrase': {
    title: 'Wrapping the key with your passphrase',
    hint: 'Running scrypt on the passphrase you typed. Slow on purpose — same KDF that defends unlock from offline brute-force.',
  },
  'wrap-keyring': {
    title: 'Wrapping the key with the device secret',
    hint: 'Second scrypt pass, this time using a random secret bound to this machine via the OS keyring.',
  },
  store: {
    title: 'Storing wrap secret in the OS keyring',
    hint: 'Hands the device secret to the OS keychain and writes recipients.txt + the public key file.',
  },
  refresh: {
    title: 'Refreshing vault status',
    hint: 'Picking up the new encrypted state so the UI knows the vault is set up.',
  },
};

const LOCK_STAGE_ORDER: Exclude<LockStage, null>[] = ['wipe', 'tabs', 'refresh'];

const LOCK_STAGE_LABELS: Record<
  Exclude<LockStage, null>,
  { title: string; hint: string }
> = {
  wipe: {
    title: 'Wiping the X25519 secret from memory',
    hint: 'Zeroes out the in-memory copy of your private key. Only the encrypted file on disk remains.',
  },
  tabs: {
    title: 'Closing decrypted notes',
    hint: 'Drops cached plaintext bodies and closes every open .md.age tab so nothing readable lingers.',
  },
  refresh: {
    title: 'Refreshing vault status',
    hint: 'Updates the UI to reflect the locked state.',
  },
};

function LockingProgress() {
  const stage = useCryptoStore((s) => s.lockStage);
  const currentIdx = stage == null ? -1 : LOCK_STAGE_ORDER.indexOf(stage);
  return (
    <div
      className="space-y-3 py-2"
      role="status"
      aria-live="polite"
      aria-label="Locking vault"
    >
      <div className="flex items-center justify-center gap-2">
        <Lock size={20} className="text-accent" />
        <span className="text-sm font-medium text-text-primary">
          Locking your vault…
        </span>
      </div>
      <StageList
        stages={LOCK_STAGE_ORDER}
        currentIdx={currentIdx}
        labels={LOCK_STAGE_LABELS}
      />
    </div>
  );
}

function SetupProgress({
  hasPassphrase,
  mode,
}: {
  hasPassphrase: boolean;
  mode: 'fresh' | 'join';
}) {
  const stage = useCryptoStore((s) => s.setupStage);
  // `wrap-passphrase` only fires when a passphrase was chosen.
  const stages = SETUP_STAGE_ORDER.filter(
    (s) => s !== 'wrap-passphrase' || hasPassphrase,
  );
  const currentIdx = stage == null ? -1 : stages.indexOf(stage);

  return (
    <div
      className="space-y-3 py-2"
      role="status"
      aria-live="polite"
      aria-label="Setting up encryption"
    >
      <div className="flex items-center justify-center gap-2">
        <Shield size={20} className="text-accent" />
        <span className="text-sm font-medium text-text-primary">
          {mode === 'join'
            ? 'Joining this device to the vault…'
            : 'Setting up encryption…'}
        </span>
      </div>
      <StageList
        stages={stages}
        currentIdx={currentIdx}
        labels={SETUP_STAGE_LABELS}
      />
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
  const reencryptAll = useCryptoStore((s) => s.reencryptAll);
  const busy = useCryptoStore((s) => s.busy);
  const [recipients, setRecipients] = useState<string[]>([]);
  const [newRecipient, setNewRecipient] = useState('');
  const [showSetPass, setShowSetPass] = useState(false);
  const [reencryptReport, setReencryptReport] = useState<{
    rewrapped: number;
    skipped: number;
  } | null>(null);
  const primary = status?.primary_recipient ?? null;
  const hasPassphrase = status?.has_passphrase ?? false;
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
        <Row label="Passphrase">
          {hasPassphrase ? (
            <span className="text-accent">set</span>
          ) : (
            <span className="text-warning">not set</span>
          )}
        </Row>
        <Row label="Auto-lock">after {minutes} min idle</Row>
      </div>

      {!hasPassphrase && (
        <div className="p-2 rounded bg-warning/10 text-[11px] text-warning leading-relaxed space-y-2">
          <p>
            <strong>Lock provides no protection on this device.</strong>{' '}
            Anyone here can re-unlock with one click, because the OS
            keyring hands back the wrap secret silently. Add a passphrase
            to require it on every Unlock.
          </p>
          {!showSetPass && (
            <button
              onClick={() => setShowSetPass(true)}
              className="px-2 py-1 rounded border border-warning/40 hover:bg-warning/15"
            >
              Set passphrase
            </button>
          )}
          {showSetPass && <SetPassphraseForm onDone={() => setShowSetPass(false)} />}
        </div>
      )}

      <p className="text-[11px] text-text-muted bg-surface-2 p-2 rounded leading-relaxed">
        <strong className="text-text-secondary">Encryption is not retroactive.</strong>{' '}
        Clicking the lock icon on a plain note only protects writes from
        that point on — earlier saves may still exist in git history,
        sync backups, or filesystem snapshots. Create-then-encrypt only
        works when there&rsquo;s nothing sensitive yet.
      </p>

      <button
        onClick={() => lock().catch(() => undefined)}
        disabled={busy}
        className="w-full py-1.5 rounded border border-border text-text-primary text-sm hover:bg-surface-hover disabled:opacity-50 inline-flex items-center justify-center gap-2"
      >
        {busy && <Loader2 size={12} className="animate-spin" />}
        {busy ? 'Locking…' : 'Lock now'}
      </button>

      <details>
        <summary className="text-xs text-text-muted cursor-pointer select-none">
          How this works
        </summary>
        <div className="mt-2 space-y-2 text-[11px] text-text-secondary leading-relaxed">
          <p>
            <strong className="text-text-primary">Identity.</strong> Each
            vault has one X25519 keypair. The public key encrypts; the
            private key decrypts. The private key never touches disk in
            the clear — it lives in{' '}
            <code className="px-1 bg-surface-2 rounded">
              .mycel/crypto/identity.age
            </code>
            , wrapped with your passphrase (inner) and a random secret
            from the OS keyring (outer). Both factors are needed to
            unlock.
          </p>
          <p>
            <strong className="text-text-primary">Notes.</strong> Each{' '}
            <code className="px-1 bg-surface-2 rounded">*.md.age</code>{' '}
            file is an ASCII-armored age envelope encrypted to every
            recipient in{' '}
            <code className="px-1 bg-surface-2 rounded">recipients.txt</code>
            . Git / iCloud / Syncthing see only the armored bytes — no
            different from any other text blob.
          </p>
          <p>
            <strong className="text-text-primary">Lock.</strong> Wipes
            the unlocked X25519 from memory, closes every open{' '}
            <code className="px-1 bg-surface-2 rounded">.md.age</code>{' '}
            tab, and drops cached plaintext bodies. Triggers manually
            (button above), automatically after {minutes}m idle, and on
            vault switch.
          </p>
          <p>
            <strong className="text-text-primary">Passphrase storage.</strong>{' '}
            None. Typed at unlock, fed through scrypt, then dropped. Not
            in the keyring, not in any config file, not in logs. Lose
            it and the vault is unrecoverable.
          </p>
        </div>
      </details>

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
        <summary className="text-xs text-text-muted cursor-pointer select-none">
          Re-encrypt all notes
        </summary>
        <div className="mt-2 space-y-2">
          <p className="text-[11px] text-text-muted leading-relaxed">
            Rewrap every <code className="px-1 bg-surface-2 rounded">.md.age</code>{' '}
            in this vault so it includes the current recipient set. Useful
            after a new device joined — until you run this, notes
            created before the join stay readable only on the device that
            wrote them.
          </p>
          {reencryptReport && (
            <p className="text-[11px] text-accent bg-accent/10 p-2 rounded">
              Done. Rewrapped {reencryptReport.rewrapped} note
              {reencryptReport.rewrapped === 1 ? '' : 's'}
              {reencryptReport.skipped > 0
                ? `, skipped ${reencryptReport.skipped} (not decryptable by this device).`
                : '.'}
            </p>
          )}
          <button
            onClick={async () => {
              setReencryptReport(null);
              try {
                const r = await reencryptAll();
                setReencryptReport({ rewrapped: r.rewrapped, skipped: r.skipped });
              } catch {
                // store sets error
              }
            }}
            disabled={busy}
            className="w-full py-1 rounded border border-border text-text-primary text-xs hover:bg-surface-hover disabled:opacity-50"
          >
            {busy ? 'Re-encrypting…' : 'Re-encrypt all to current recipients'}
          </button>
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

function SetPassphraseForm({ onDone }: { onDone: () => void }) {
  const setPassphrase = useCryptoStore((s) => s.setPassphrase);
  const busy = useCryptoStore((s) => s.busy);
  const [pass, setPass] = useState('');
  const [confirmPass, setConfirmPass] = useState('');
  const [show, setShow] = useState(false);
  const [warn, setWarn] = useState<string | null>(null);

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
      await setPassphrase(pass);
      onDone();
    } catch {
      // surfaced by store.error
    }
  };

  return (
    <div className="space-y-2 mt-1">
      <PasswordField
        value={pass}
        onChange={setPass}
        show={show}
        onToggle={() => setShow((s) => !s)}
        placeholder="New passphrase (≥8 chars)"
        autoFocus
      />
      <PasswordField
        value={confirmPass}
        onChange={setConfirmPass}
        show={show}
        onToggle={() => setShow((s) => !s)}
        placeholder="Confirm passphrase"
        onEnter={submit}
      />
      {warn && <p className="text-error">{warn}</p>}
      <div className="flex gap-1">
        <button
          onClick={submit}
          disabled={busy}
          className="flex-1 py-1 rounded bg-warning/20 text-warning text-xs font-medium hover:bg-warning/30 disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Save passphrase'}
        </button>
        <button
          onClick={onDone}
          className="px-2 py-1 text-text-muted hover:text-text-primary text-xs"
        >
          Cancel
        </button>
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
