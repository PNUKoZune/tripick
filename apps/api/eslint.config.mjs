// @ts-check
import { baseTsConfig, sharedIgnores, prettier, globals } from '../../eslint.config.base.mjs';

/** NestJS(Node) API — 순수 TypeScript, typescript-eslint 권장 규칙 기반. */
export default [
  { ignores: sharedIgnores },
  ...baseTsConfig,
  {
    languageOptions: {
      sourceType: 'module',
      globals: { ...globals.node, ...globals.jest },
    },
  },
  prettier,
];
