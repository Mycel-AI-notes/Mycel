/**
 * ESLint config for the Mycel frontend.
 *
 * Scope is deliberately narrow: correctness rules that catch real bugs
 * (stale hook deps, unreachable branches, accidental globals) and nothing
 * stylistic. Formatting is not linted — there is no Prettier in the tree and
 * a formatting-flavoured lint run would bury the findings that matter.
 *
 * `npm run lint` must stay green. A new rule that fires on existing code
 * belongs in the same PR as the fixes for it.
 */
module.exports = {
  root: true,
  env: { browser: true, es2020: true },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react-hooks/recommended',
  ],
  ignorePatterns: ['dist', 'node_modules', 'src-tauri', '.eslintrc.cjs'],
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
  plugins: ['@typescript-eslint', 'react-refresh'],
  rules: {
    // Vite HMR wants component modules to export only components. Warn,
    // because a few modules legitimately co-export constants.
    'react-refresh/only-export-components': [
      'warn',
      { allowConstantExport: true },
    ],
    // `noUnusedLocals` / `noUnusedParameters` in tsconfig already cover this,
    // and tsc understands type-only usage better than the lint rule does.
    '@typescript-eslint/no-unused-vars': 'off',
    // Deliberate `any` shows up at the Tauri IPC and CodeMirror boundaries,
    // where the upstream types are wider than what we can usefully narrow.
    '@typescript-eslint/no-explicit-any': 'warn',
  },
};
