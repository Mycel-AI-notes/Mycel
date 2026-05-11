import { useEffect, useState } from 'react';
import { Lock, Info, FileLock2, X, Copy } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { useCryptoStore, AUTO_LOCK_IDLE_MS } from '@/stores/crypto';

/**
 * Banner above the editor when the active note is `.md.age`. Three jobs:
 *
 *   1. Make it visually obvious the open note is encrypted — the file
 *      tree icon alone is too easy to miss once you're heads-down.
 *   2. Surface where the bytes actually live (`path.md.age`), so the
 *      user knows the difference between "my note" and "this is what
 *      GitHub will see".
 *   3. Provide a one-click *Show on disk* peek that opens the raw
 *      armored age block, plus a short *How this works* explainer.
 */
export function EncryptedNoteBanner({ path }: { path: string }) {
  const [showInfo, setShowInfo] = useState(false);
  const status = useCryptoStore((s) => s.status);
  const minutes = Math.round(AUTO_LOCK_IDLE_MS / 60_000);

  return (
    <div className="flex items-center gap-2 px-4 py-1.5 border-b border-accent/40 bg-accent/8 text-accent text-xs shrink-0">
      <Lock size={12} className="shrink-0" />
      <span className="font-mono truncate flex-1" title={path}>
        {path}
      </span>
      <span className="text-text-muted hidden md:inline">
        encrypted to {status?.recipients ?? 0}{' '}
        {status?.recipients === 1 ? 'recipient' : 'recipients'} · auto-lock {minutes}m
      </span>
      <button
        onClick={() => setShowInfo(true)}
        className="flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-accent/15 transition-colors"
        title="Show how this note looks on disk and how encryption works"
      >
        <Info size={11} />
        Inspect
      </button>

      {showInfo && (
        <EncryptedNoteInfo path={path} onClose={() => setShowInfo(false)} />
      )}
    </div>
  );
}

function EncryptedNoteInfo({ path, onClose }: { path: string; onClose: () => void }) {
  const status = useCryptoStore((s) => s.status);
  const [ciphertext, setCiphertext] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    invoke<string>('note_read_ciphertext', { path })
      .then(setCiphertext)
      .catch((e) => setErr(String(e)));
  }, [path]);

  return (
    <div
      className="fixed inset-0 z-40 bg-black/40 flex items-center justify-center p-6"
      onClick={onClose}
    >
      <div
        className="bg-surface-1 border border-border rounded-lg shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-2 border-b border-border shrink-0">
          <h2 className="text-sm font-semibold text-text-primary flex items-center gap-2">
            <FileLock2 size={14} className="text-accent" />
            Encrypted note: <code className="font-mono text-text-secondary">{path}</code>
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-surface-hover text-text-muted"
            title="Close"
          >
            <X size={14} />
          </button>
        </div>

        <div className="overflow-y-auto p-4 space-y-4 text-xs text-text-secondary">
          <section className="space-y-2">
            <h3 className="text-text-primary font-semibold">How this note is protected</h3>
            <p className="leading-relaxed">
              The body you see in the editor is the <em>plaintext</em>, held
              in this app&rsquo;s memory only. On disk the file is{' '}
              <code className="px-1 bg-surface-2 rounded">{path}</code> — an
              ASCII-armored{' '}
              <a
                href="https://age-encryption.org"
                target="_blank"
                rel="noreferrer"
                className="text-accent underline"
              >
                age
              </a>{' '}
              blob encrypted to {status?.recipients ?? 0}{' '}
              X25519{' '}
              {status?.recipients === 1 ? 'recipient' : 'recipients'} (the
              public keys listed in{' '}
              <code className="px-1 bg-surface-2 rounded">
                .mycel/crypto/recipients.txt
              </code>
              ). Anyone with one of the matching private keys can decrypt
              it; everyone else — including GitHub and any sync backend —
              sees only the armored bytes below.
            </p>
            <p className="leading-relaxed">
              When you save, the new plaintext is re-encrypted with the
              current recipient set and atomically rewritten. When you{' '}
              <strong>Lock</strong> the vault (or after{' '}
              {Math.round(AUTO_LOCK_IDLE_MS / 60_000)}m of idle), the
              in-memory X25519 secret is wiped and this tab closes.
            </p>
          </section>

          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-text-primary font-semibold">
                On disk (what GitHub / Sync see)
              </h3>
              {ciphertext && (
                <button
                  onClick={() => {
                    void navigator.clipboard.writeText(ciphertext);
                  }}
                  className="flex items-center gap-1 text-text-muted hover:text-text-primary px-1.5 py-0.5 rounded hover:bg-surface-hover"
                  title="Copy ciphertext"
                >
                  <Copy size={11} /> Copy
                </button>
              )}
            </div>
            <pre className="bg-surface-0 border border-border rounded p-2 text-[10px] font-mono overflow-x-auto whitespace-pre-wrap break-all max-h-72">
              {err ? `Failed to read: ${err}` : ciphertext ?? 'Loading…'}
            </pre>
          </section>

          <section className="space-y-2">
            <h3 className="text-text-primary font-semibold">Layout under .mycel/crypto/</h3>
            <pre className="bg-surface-0 border border-border rounded p-2 text-[10px] font-mono overflow-x-auto">
{`identity.age      # X25519 secret, wrapped with your passphrase
                  # (inner) and a random KEK from the OS keyring
                  # (outer). Both factors needed to unlock.
pubkey.txt        # primary public key — used to encrypt new notes
                  # without unlocking the vault
recipients.txt    # every public key allowed to decrypt notes in this
                  # vault. Add another device's key here for
                  # multi-device access.`}
            </pre>
          </section>
        </div>
      </div>
    </div>
  );
}
