import { useState } from 'react';
import { openPath } from '@tauri-apps/plugin-opener';
import { convertFileSrc } from '@tauri-apps/api/core';
import { Maximize2, Minimize2, ExternalLink } from 'lucide-react';
import { useVaultStore } from '@/stores/vault';

interface Props {
  path: string;
}

/**
 * Full-tab image viewer. Used when the user clicks an inline image in
 * a note or opens an attachment from any "Open in tab" affordance.
 * The viewer is intentionally minimal — fitting the image to the
 * viewport, with a toggle for 1:1 zoom — because images in this app
 * are illustrations, not the primary content the user edits.
 */
export function ImageViewer({ path }: Props) {
  const vaultRoot = useVaultStore((s) => s.vaultRoot);
  const [actualSize, setActualSize] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);

  if (!vaultRoot) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-muted">
        No vault open
      </div>
    );
  }

  const absPath = `${vaultRoot}/${path.replace(/^\/+/, '')}`;
  const src = convertFileSrc(absPath);
  const filename = path.split('/').pop() ?? path;

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-1.5 border-b border-border bg-surface-0 shrink-0">
        <span className="text-xs text-text-muted font-mono truncate">{path}</span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setActualSize((v) => !v)}
            className="flex items-center gap-1 text-xs text-text-muted hover:text-text-primary px-2 py-0.5 rounded hover:bg-surface-hover transition-colors"
            title={actualSize ? 'Fit to viewport' : 'Show at actual size'}
          >
            {actualSize ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
            {actualSize ? 'Fit' : '1:1'}
          </button>
          <button
            onClick={async () => {
              setOpenError(null);
              try {
                await openPath(absPath);
              } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                setOpenError(msg);
              }
            }}
            className="flex items-center gap-1 text-xs text-text-muted hover:text-text-primary px-2 py-0.5 rounded hover:bg-surface-hover transition-colors"
            title={openError ? `Failed: ${openError}` : 'Open in system viewer'}
          >
            <ExternalLink size={12} /> {openError ? 'Failed' : 'Open'}
          </button>
        </div>
      </div>

      <div
        className={
          'flex-1 overflow-auto bg-surface-1 flex items-center justify-center p-6 ' +
          (actualSize ? '' : '')
        }
      >
        <img
          src={src}
          alt={filename}
          draggable={false}
          className={
            actualSize
              ? 'max-w-none'
              : 'max-w-full max-h-full object-contain'
          }
        />
      </div>
    </div>
  );
}
