import js from '@eslint/js';
import nextPlugin from '@next/eslint-plugin-next';
import prettier from 'eslint-config-prettier';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import coal from './eslint-plugin-coal.mjs';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/dist/**',
      'backend/migrations/**',
      'backend/openapi.json',
      'web/next-env.d.ts',
      'docs/**',
      'private/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
      globals: { ...globals.node },
    },
    plugins: { coal },
    rules: {
      'coal/part-boundaries': 'error',
      'coal/module-tables': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/only-throw-error': 'error',
      // Fastify hooks and handlers are async whether or not they await.
      '@typescript-eslint/require-await': 'off',
    },
  },
  {
    files: ['**/*.mjs', '**/*.js', '**/*.d.mts'],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    files: ['**/*.test.ts', 'backend/test/**', 'backend/eval/**'],
    rules: {
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      // Tests read untyped JSON from the API.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
  {
    files: ['web/**/*.{ts,tsx}'],
    plugins: { react, 'react-hooks': reactHooks, '@next/next': nextPlugin },
    languageOptions: { globals: { ...globals.browser } },
    settings: { react: { version: 'detect' }, next: { rootDir: 'web' } },
    rules: {
      ...react.configs.flat.recommended.rules,
      ...react.configs.flat['jsx-runtime'].rules,
      ...reactHooks.configs.recommended.rules,
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
      // All website text lives in web/messages, ready for translation (P22).
      'react/jsx-no-literals': [
        'error',
        { noStrings: true, ignoreProps: true, allowedStrings: [' ', '·', '—', '/', '×', '→'] },
      ],
      '@next/next/no-html-link-for-pages': 'off',
    },
  },
  prettier,
);
