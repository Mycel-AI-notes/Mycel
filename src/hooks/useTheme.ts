import { useEffect } from 'react';
import { useUIStore } from '@/stores/ui';

export function useTheme() {
  const theme = useUIStore((s) => s.theme);
  const palette = useUIStore((s) => s.palette);

  useEffect(() => {
    const root = document.documentElement;

    if (theme === 'system') {
      const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      root.classList.toggle('dark', dark);
    } else {
      root.classList.toggle('dark', theme === 'dark');
    }
  }, [theme]);

  useEffect(() => {
    document.documentElement.setAttribute('data-palette', palette);
  }, [palette]);

  useEffect(() => {
    if (useUIStore.getState().theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => {
      document.documentElement.classList.toggle('dark', e.matches);
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
}
