import js from '@eslint/js';
import globals from 'globals';

export default [
  // lib/_shared/ is a generated copy of shared/, which is linted at the source.
  { ignores: ['node_modules/', 'plugins/*/lib/_shared/'] },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.node,
    },
  },
];
