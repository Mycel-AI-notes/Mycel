/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        surface: {
          0: 'var(--color-surface-0)',
          1: 'var(--color-surface-1)',
          2: 'var(--color-surface-2)',
          hover: 'var(--color-surface-hover)',
        },
        text: {
          primary: 'var(--color-text-primary)',
          secondary: 'var(--color-text-secondary)',
          muted: 'var(--color-text-muted)',
          disabled: 'var(--color-text-disabled)',
        },
        accent: {
          DEFAULT: 'var(--color-accent)',
          bright: 'var(--color-accent-bright)',
          muted: 'var(--color-accent-muted)',
          deep: 'var(--color-accent-deep)',
        },
        border: {
          DEFAULT: 'var(--color-border)',
          strong: 'var(--color-border-strong)',
        },
        success: 'var(--color-success)',
        warning: 'var(--color-warning)',
        error: 'var(--color-error)',
        info: 'var(--color-info)',
        graph: {
          active: 'var(--color-graph-active)',
          connected: 'var(--color-graph-connected)',
          inactive: 'var(--color-graph-inactive)',
          edge: 'var(--color-graph-edge)',
          'edge-glow': 'var(--color-graph-edge-glow)',
        },
        wikilink: 'var(--color-wikilink)',
        'wikilink-broken': 'var(--color-wikilink-broken)',
        tag: 'var(--color-tag)',
        embedding: 'var(--color-embedding)',
      },
      boxShadow: {
        glow: 'var(--shadow-glow)',
        'glow-sm': '0 0 12px color-mix(in srgb, var(--color-accent) 22%, transparent)',
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
}
