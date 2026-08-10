// @ts-check
import coreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';
import { sharedIgnores, sharedRules, prettier } from '../../eslint.config.base.mjs';

/** Next.js(App Router) 웹앱 — eslint-config-next flat 프리셋 기반. */
export default [
  { ignores: sharedIgnores },
  ...coreWebVitals,
  ...nextTypescript,
  { rules: sharedRules },
  prettier,
];
