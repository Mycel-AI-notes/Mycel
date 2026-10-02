/** True on macOS (and iOS), where `Mod` means ⌘ rather than Ctrl. */
export const isMac =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform);
