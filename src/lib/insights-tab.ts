// Insights lives in the main editor area as a full-page view (like Garden),
// carried by a synthetic tab path so the existing Tab[] / pin / preview
// machinery works without a parallel system. Insights has a single view,
// so unlike `garden-tab.ts` there's no sub-kind to encode.

export const INSIGHTS_TAB_PATH = 'insights:inbox';

export function isInsightsTabPath(path: string | null | undefined): boolean {
  return path === INSIGHTS_TAB_PATH;
}

export const INSIGHTS_TAB_TITLE = 'Insights';
