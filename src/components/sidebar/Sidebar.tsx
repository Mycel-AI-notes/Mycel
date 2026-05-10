import { FileTree } from './FileTree';

export function Sidebar() {
  return (
    <aside className="flex flex-col h-full bg-surface-0 border-r border-border w-56 shrink-0">
      <FileTree />
    </aside>
  );
}
