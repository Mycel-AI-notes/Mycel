import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { PropType } from '@/lib/page-meta';

/**
 * What the app remembers about each property name across notes: the type
 * the user picked, the options a select offers, and option colours. The
 * values themselves always live in the note's frontmatter; this only saves
 * re-teaching "status is a select with Draft / In progress / Done" on every
 * page. A name with no entry falls back to `inferType` on its value.
 */
export interface PropertyDef {
  type?: PropType;
  options?: string[];
  /** Option → tag-palette hue index, as in database select columns. */
  colors?: Record<string, number>;
}

interface PropertiesState {
  defs: Record<string, PropertyDef>;
  setType: (key: string, type: PropType) => void;
  addOptions: (key: string, options: string[]) => void;
  setOptionColor: (key: string, option: string, hue: number | null) => void;
  renameDef: (from: string, to: string) => void;
}

const norm = (key: string) => key.trim().toLowerCase();

export const usePropertiesStore = create<PropertiesState>()(
  persist(
    (set) => ({
      defs: {},
      setType: (key, type) =>
        set((s) => ({ defs: { ...s.defs, [norm(key)]: { ...s.defs[norm(key)], type } } })),
      addOptions: (key, options) =>
        set((s) => {
          const def = s.defs[norm(key)] ?? {};
          const have = new Set(def.options ?? []);
          const fresh = options.filter((o) => o && !have.has(o));
          if (fresh.length === 0) return s;
          return {
            defs: {
              ...s.defs,
              [norm(key)]: { ...def, options: [...(def.options ?? []), ...fresh] },
            },
          };
        }),
      setOptionColor: (key, option, hue) =>
        set((s) => {
          const def = s.defs[norm(key)] ?? {};
          const colors = { ...(def.colors ?? {}) };
          if (hue === null) delete colors[option];
          else colors[option] = hue;
          return { defs: { ...s.defs, [norm(key)]: { ...def, colors } } };
        }),
      renameDef: (from, to) =>
        set((s) => {
          const def = s.defs[norm(from)];
          if (!def || s.defs[norm(to)]) return s;
          return { defs: { ...s.defs, [norm(to)]: def } };
        }),
    }),
    { name: 'mycel-properties' },
  ),
);

export function propertyDef(key: string): PropertyDef {
  return usePropertiesStore.getState().defs[norm(key)] ?? {};
}

export function usePropertyDef(key: string): PropertyDef {
  return usePropertiesStore((s) => s.defs[norm(key)]) ?? EMPTY;
}

const EMPTY: PropertyDef = {};
