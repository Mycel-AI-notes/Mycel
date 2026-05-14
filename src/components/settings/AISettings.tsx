import { useEffect, useState } from 'react';
import {
  Eye,
  EyeOff,
  CheckCircle2,
  XCircle,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { useAiStore } from '@/stores/ai';

/// AI settings card. Lives inside the existing SettingsDialog.
///
/// Renders nothing until `load()` resolves — keeps the dialog from
/// flickering between "no key" and the real state on each open. If no vault
/// is open (status stays null), shows a single hint line rather than the
/// full form.
export function AISettings() {
  const status = useAiStore((s) => s.status);
  const lastError = useAiStore((s) => s.lastError);
  const testResult = useAiStore((s) => s.testResult);
  const load = useAiStore((s) => s.load);
  const setEnabled = useAiStore((s) => s.setEnabled);
  const setBudget = useAiStore((s) => s.setBudget);
  const setKey = useAiStore((s) => s.setKey);
  const clearKey = useAiStore((s) => s.clearKey);
  const testKey = useAiStore((s) => s.testKey);
  const indexStatus = useAiStore((s) => s.indexStatus);
  const indexing = useAiStore((s) => s.indexing);
  const indexProgress = useAiStore((s) => s.indexProgress);
  const lastBulkSummary = useAiStore((s) => s.lastBulkSummary);
  const reindexAll = useAiStore((s) => s.reindexAll);

  const [keyInput, setKeyInput] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [budgetInput, setBudgetInput] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    void load();
  }, [load]);

  // Sync local budget input with backend state whenever it arrives, but only
  // when the input is empty — otherwise we'd clobber the user's in-progress
  // typing on every status refresh.
  useEffect(() => {
    if (status && budgetInput === '') {
      setBudgetInput(status.daily_budget_usd.toFixed(2));
    }
  }, [status, budgetInput]);

  if (!status) {
    return (
      <div className="text-xs text-text-muted">
        Open a vault to configure AI.
      </div>
    );
  }

  const usage = status.usage_today;
  const pctUsed =
    status.daily_budget_usd > 0
      ? Math.min(100, (usage.cost_usd / status.daily_budget_usd) * 100)
      : 0;

  const handleSaveKey = async () => {
    const trimmed = keyInput.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      await setKey(trimmed);
      setKeyInput('');
    } catch {
      // error surfaces via lastError
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    try {
      await testKey();
    } finally {
      setTesting(false);
    }
  };

  const handleBudgetBlur = async () => {
    const parsed = parseFloat(budgetInput);
    if (Number.isFinite(parsed) && parsed >= 0 && parsed !== status.daily_budget_usd) {
      await setBudget(parsed);
    } else if (!Number.isFinite(parsed)) {
      setBudgetInput(status.daily_budget_usd.toFixed(2));
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-3">
        <input
          id="ai-enabled"
          type="checkbox"
          checked={status.enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="mt-1"
        />
        <label htmlFor="ai-enabled" className="flex-1 cursor-pointer">
          <div className="text-sm text-text-primary">Enable AI</div>
          <div className="text-xs text-text-muted mt-0.5">
            Master switch. When off, Mycel makes no network calls and the AI
            UI stays hidden. Read-only — nothing is written to your notes.
          </div>
        </label>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="ai-key" className="text-xs text-text-secondary">
          OpenRouter API key
        </label>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <input
              id="ai-key"
              type={showKey ? 'text' : 'password'}
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              placeholder={status.has_key ? '•••••••• (saved)' : 'sk-or-…'}
              autoComplete="off"
              spellCheck={false}
              className="w-full px-2.5 py-1.5 pr-9 rounded-md border border-border bg-surface-0 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
            />
            <button
              type="button"
              onClick={() => setShowKey((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-text-muted hover:text-text-primary"
              title={showKey ? 'Hide' : 'Show'}
            >
              {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
          <button
            type="button"
            onClick={handleSaveKey}
            disabled={!keyInput.trim() || saving}
            className="px-3 py-1.5 rounded-md border border-border bg-surface-1 text-sm text-text-primary hover:bg-surface-hover disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Save
          </button>
        </div>
        <div className="flex items-center justify-between mt-1">
          <div className="text-[11px] text-text-muted">
            Stored in your OS keyring. Never written to a file.
          </div>
          <div className="flex items-center gap-2">
            {status.has_key && (
              <button
                type="button"
                onClick={() => void clearKey()}
                className="text-[11px] text-text-muted hover:text-text-primary"
              >
                Remove
              </button>
            )}
            <button
              type="button"
              onClick={handleTest}
              disabled={!status.has_key || testing}
              className="px-2 py-0.5 rounded text-[11px] border border-border bg-surface-1 text-text-secondary hover:bg-surface-hover disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {testing ? (
                <span className="inline-flex items-center gap-1">
                  <Loader2 size={11} className="animate-spin" /> Testing…
                </span>
              ) : (
                'Test'
              )}
            </button>
          </div>
        </div>
        {testResult && testResult.ok && (
          <div className="flex items-center gap-1 text-[11px] text-success mt-0.5">
            <CheckCircle2 size={12} /> connected ({testResult.model})
          </div>
        )}
        {testResult && !testResult.ok && (
          <div className="flex items-center gap-1 text-[11px] text-error mt-0.5">
            <XCircle size={12} /> {lastError ?? 'test failed'}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="ai-budget" className="text-xs text-text-secondary">
          Daily budget (USD)
        </label>
        <input
          id="ai-budget"
          type="number"
          min={0}
          step={0.1}
          value={budgetInput}
          onChange={(e) => setBudgetInput(e.target.value)}
          onBlur={handleBudgetBlur}
          className="w-32 px-2.5 py-1.5 rounded-md border border-border bg-surface-0 text-sm text-text-primary focus:outline-none focus:border-accent"
        />
        <div className="flex items-center gap-2 mt-1">
          <div className="flex-1 h-1.5 rounded-full bg-surface-0 overflow-hidden">
            <div
              className="h-full bg-accent transition-[width] duration-300"
              style={{ width: `${pctUsed}%` }}
            />
          </div>
          <div className="text-[11px] text-text-muted tabular-nums">
            ${usage.cost_usd.toFixed(4)} / ${status.daily_budget_usd.toFixed(2)} today
          </div>
        </div>
        <div className="text-[11px] text-text-muted">
          Embedding requests pause when the budget is hit; resets at local
          midnight. Model: {status.embedding_model}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <label className="text-xs text-text-secondary">Index</label>
          <button
            type="button"
            onClick={() => void reindexAll()}
            disabled={!status.enabled || !status.has_key || indexing}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-border bg-surface-1 text-xs text-text-primary hover:bg-surface-hover disabled:opacity-50 disabled:cursor-not-allowed"
            title={
              !status.enabled
                ? 'Enable AI first'
                : !status.has_key
                ? 'Save an API key first'
                : 'Walk the vault and embed any new or changed chunks'
            }
          >
            {indexing ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <RefreshCw size={12} />
            )}
            {indexing ? 'Indexing…' : 'Reindex now'}
          </button>
        </div>

        {indexStatus && (
          <div className="text-[11px] text-text-muted">
            {indexStatus.chunks_indexed.toLocaleString()} chunks across{' '}
            {indexStatus.notes_indexed.toLocaleString()} notes
          </div>
        )}

        {indexing && indexProgress && (
          <div className="flex flex-col gap-1 mt-0.5">
            <div className="h-1.5 rounded-full bg-surface-0 overflow-hidden">
              <div
                className="h-full bg-accent transition-[width] duration-150"
                style={{
                  width: `${indexProgress.total > 0 ? (indexProgress.done / indexProgress.total) * 100 : 0}%`,
                }}
              />
            </div>
            <div className="flex items-center justify-between text-[11px] text-text-muted tabular-nums">
              <span className="truncate" title={indexProgress.note_path}>
                {indexProgress.note_path}
              </span>
              <span>
                {indexProgress.done} / {indexProgress.total}
              </span>
            </div>
            {indexProgress.error && (
              <div className="text-[11px] text-error">
                {indexProgress.error}
              </div>
            )}
          </div>
        )}

        {!indexing && lastBulkSummary && (
          <div className="text-[11px] text-text-muted">
            Last run: {lastBulkSummary.notes_ok} indexed,{' '}
            {lastBulkSummary.chunks_embedded} chunks embedded,{' '}
            {lastBulkSummary.chunks_kept} kept
            {lastBulkSummary.notes_failed > 0 && (
              <span className="text-error">
                {' '}
                · {lastBulkSummary.notes_failed} failed
              </span>
            )}
          </div>
        )}
      </div>

      {lastError && !testResult && (
        <div className="text-[11px] text-error">{lastError}</div>
      )}
    </div>
  );
}
