// Encoding for Garden views inside the regular tab strip. Garden tabs use
// synthetic "paths" starting with `garden:` so the existing Tab[] / pin /
// preview machinery can carry them without a parallel system.

import type { GardenView } from '@/types/garden';

export const GARDEN_TAB_PREFIX = 'garden:';

export function gardenTabPath(view: GardenView): string {
  switch (view.kind) {
    case 'project-detail':
      return `${GARDEN_TAB_PREFIX}project/${view.id}`;
    default:
      return `${GARDEN_TAB_PREFIX}${view.kind}`;
  }
}

export function parseGardenTabPath(path: string): GardenView | null {
  if (!path.startsWith(GARDEN_TAB_PREFIX)) return null;
  const rest = path.slice(GARDEN_TAB_PREFIX.length);
  if (rest.startsWith('project/')) {
    return { kind: 'project-detail', id: rest.slice('project/'.length) };
  }
  switch (rest) {
    case 'inbox': return { kind: 'inbox' };
    case 'actions': return { kind: 'actions' };
    case 'projects': return { kind: 'projects' };
    case 'waiting': return { kind: 'waiting' };
    case 'someday': return { kind: 'someday' };
    case 'review': return { kind: 'review' };
    default: return null;
  }
}

export function isGardenTabPath(path: string | null | undefined): boolean {
  return typeof path === 'string' && path.startsWith(GARDEN_TAB_PREFIX);
}

export function gardenTabTitle(view: GardenView): string {
  switch (view.kind) {
    case 'inbox': return 'Inbox';
    case 'actions': return 'Next Actions';
    case 'projects': return 'Projects';
    case 'waiting': return 'Waiting For';
    case 'someday': return 'Someday';
    case 'review': return 'Weekly Review';
    case 'project-detail': return 'Project';
  }
}
