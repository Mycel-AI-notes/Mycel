import { useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { LayoutTemplate } from 'lucide-react';
import { useUIStore } from '@/stores/ui';
import { useVaultStore } from '@/stores/vault';
import { describeError, useToastStore } from '@/stores/toast';
import { PickerDialog } from '@/components/search/PickerDialog';
import { applyTemplate, listTemplates } from '@/lib/templates';
import { insertAtCursor } from '@/lib/editor-registry';
import { displayName } from '@/lib/note-name';
import type { Note } from '@/types';

/**
 * "Insert template…" — reached from the palette and from `/template` in the
 * editor. Lists the `.md` files in the templates folder and inserts the
 * chosen one, variables filled, at the active editor's cursor.
 */
export function TemplatePicker() {
  const close = useUIStore((s) => s.setTemplatePickerOpen);
  const folder = useUIStore((s) => s.templatesFolder);
  const fileTree = useVaultStore((s) => s.fileTree);

  const items = useMemo(
    () =>
      listTemplates(fileTree, folder).map((t) => ({
        id: t.path,
        label: t.name,
        detail: t.path,
      })),
    [fileTree, folder],
  );

  const insert = async (templatePath: string) => {
    const target = useVaultStore.getState().activeTabPath;
    if (!target) return;
    try {
      // Read fresh from disk rather than the note cache: the template may
      // have been edited in another tab and not reloaded since.
      const note = await invoke<Note>('note_read', { path: templatePath });
      const text = applyTemplate(note.content, { now: new Date(), title: displayName(target) });
      insertAtCursor(target, text);
    } catch (e) {
      useToastStore.getState().error(`Could not insert template: ${describeError(e)}`);
    }
  };

  return (
    <PickerDialog
      items={items}
      placeholder="Insert template…"
      emptyText={`No templates in ${folder}/ — add a .md file there`}
      icon={<LayoutTemplate size={16} className="text-text-muted shrink-0" />}
      onClose={() => close(false)}
      onPick={(item) => void insert(item.id)}
    />
  );
}
