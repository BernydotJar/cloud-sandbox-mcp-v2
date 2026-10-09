import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'coverage/**', 'data/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['mac-host/**/*.mjs', 'scripts/*.mjs'],
    languageOptions: {
      globals: {process: 'readonly', console: 'readonly', URL: 'readonly',
        Buffer: 'readonly', fetch: 'readonly'}
    }
  },
  {
    files: ['**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }]
    }
  }
);
