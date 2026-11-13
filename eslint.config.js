import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'coverage/**', 'data/**', 'deploy/baselines/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['mac-host/**/*.mjs', 'scripts/*.mjs'],
    languageOptions: {
      globals: {process: 'readonly', console: 'readonly', URL: 'readonly',
        Buffer: 'readonly', fetch: 'readonly', AbortSignal: 'readonly', Response: 'readonly'}
    }
  },
  {
    files: ['deploy/browser-dom/extension/*.js'],
    languageOptions: {globals: {window:'readonly',chrome:'readonly',document:'readonly',location:'readonly',crypto:'readonly',getComputedStyle:'readonly',NodeFilter:'readonly',HTMLInputElement:'readonly',HTMLTextAreaElement:'readonly',Event:'readonly',TextEncoder:'readonly',URL:'readonly'}}
  },
  {
    files: ['**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }]
    }
  }
);
