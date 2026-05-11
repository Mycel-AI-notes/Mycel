// Garden + database both want the same styled select. The original lives in
// components/database/Select.tsx with its CSS classes baked into index.css —
// re-export here so non-database call sites have a clean import path.
export { Select } from '@/components/database/Select';
export type { SelectOption } from '@/components/database/Select';
