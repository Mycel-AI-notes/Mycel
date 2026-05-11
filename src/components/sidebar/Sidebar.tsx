import { useCallback, useEffect, useRef, useState } from 'react';
import { clsx } from 'clsx';
import { FileTree } from './FileTree';
import {
  useUIStore,
  SIDEBAR_MIN_WIDTH,
  SIDEBAR_MAX_WIDTH,
} from '@/stores/ui';
import { SyncStatusBadge } from '@/components/sync/SyncStatusBadge';
import { SyncPanel } from '@/components/sync/SyncPanel';
import { GardenSidebar } from '@/components/garden/GardenSidebar';

export function Sidebar() {
  const sidebarWidth = useUIStore((s) => s.sidebarWidth);
  const setSidebarWidth = useUIStore((s) => s.setSidebarWidth);
  const asideRef = useRef<HTMLElement>(null);
  const [resizing, setResizing] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false);

  const startResize = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      setResizing(true);
      const startX = e.clientX;
      const left = asideRef.current?.getBoundingClientRect().left ?? 0;

      const onMove = (ev: PointerEvent) => {
        // Width = distance from sidebar's left edge to the cursor.
        // Uses absolute position so it stays accurate even if the cursor
        // briefly leaves the handle.
        const next = ev.clientX - left;
        setSidebarWidth(
          Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, next)),
        );
      };
      const onUp = () => {
        setResizing(false);
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
      // Silence "startX" unused-var lint without changing behavior.
      void startX;
    },
    [setSidebarWidth],
  );

  // Prevent text selection while dragging the handle.
  useEffect(() => {
    if (!resizing) return;
    const prev = document.body.style.userSelect;
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
    return () => {
      document.body.style.userSelect = prev;
      document.body.style.cursor = '';
    };
  }, [resizing]);

  return (
    <aside
      ref={asideRef}
      className="relative flex flex-col h-full bg-surface-0 border-r border-border shrink-0"
      style={{ width: `${sidebarWidth}px` }}
    >
      <div className="flex flex-col min-h-0 flex-1">
        <GardenSidebar />
        <div className="flex-1 min-h-0 overflow-hidden">
          <FileTree />
        </div>
      </div>

      <div className="flex items-center justify-end gap-1 px-2 py-1.5 border-t border-border bg-surface-0">
        <SyncStatusBadge onClick={() => setSyncOpen(true)} />
      </div>

      {syncOpen && <SyncPanel onClose={() => setSyncOpen(false)} />}

      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        onPointerDown={startResize}
        onDoubleClick={() => setSidebarWidth(224)}
        className={clsx(
          'absolute top-0 right-0 h-full w-1 -mr-0.5 cursor-col-resize z-10 group',
          'hover:bg-accent/40 transition-colors',
          resizing && 'bg-accent/60',
        )}
        title="Drag to resize · double-click to reset"
      />
    </aside>
  );
}
