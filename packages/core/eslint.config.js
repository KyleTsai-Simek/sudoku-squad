// ESLint flat config for @sudoku-squad/core.
//
// The single most important job of this config is to fail loudly when someone
// pulls a platform-specific dependency into the shared engine. Per
// docs/ARCHITECTURE.md §1 and docs/DECISIONS.md #0003 / #0012, packages/core
// must stay platform-agnostic and must never import the Norvig solver from
// scripts/ingest. If you're adding a new restriction, document the *why* in
// the message so the next agent doesn't strip it back out.

import tsParser from '@typescript-eslint/parser';

const FORBIDDEN_PACKAGES = [
  {
    group: ['next', 'next/*'],
    message:
      'packages/core must stay platform-agnostic. Next.js imports belong in apps/web only.',
  },
  {
    group: ['react-dom', 'react-dom/*'],
    message:
      'packages/core must stay platform-agnostic. react-dom belongs in apps/web only.',
  },
  {
    group: ['react-native', 'react-native/*', 'expo', 'expo/*', 'expo-*'],
    message:
      'packages/core must stay platform-agnostic. React Native / Expo imports belong in apps/ios only.',
  },
  {
    group: ['**/scripts/ingest/**', '**/scripts/ingest', '@sudoku-squad/ingest'],
    message:
      'The Norvig solver lives in scripts/ingest and must never reach the client. See docs/DECISIONS.md #0012.',
  },
];

const FORBIDDEN_GLOBALS = [
  'window',
  'document',
  'localStorage',
  'sessionStorage',
  'navigator',
  'history',
  'location',
].map((name) => ({
  name,
  message: `Direct \`${name}\` access ties packages/core to the browser. Inject a platform capability instead — see docs/ARCHITECTURE.md §8.`,
}));

export default [
  {
    ignores: ['dist/**', 'node_modules/**', '*.config.js'],
  },
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
      },
    },
    rules: {
      'no-restricted-imports': ['error', { patterns: FORBIDDEN_PACKAGES }],
      'no-restricted-globals': ['error', ...FORBIDDEN_GLOBALS],
    },
  },
];
