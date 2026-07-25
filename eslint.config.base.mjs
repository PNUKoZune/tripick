// @ts-check
/**
 * TriPick 워크스페이스 공유 ESLint flat config 조각.
 *
 * web(Next)·mobile(React Native)은 각자의 프리셋이 이미 `@typescript-eslint`
 * 플러그인을 등록하므로 base 의 typescript-eslint 를 다시 얹으면 flat config 가
 * "plugin 중복 정의"로 실패한다. 따라서 여기서는 공통 규칙·ignore 만 내보내고,
 * 순수 TypeScript 패키지(NestJS API 등)만 baseTsConfig 를 그대로 사용한다.
 */
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettierConfig from 'eslint-config-prettier';
import globals from 'globals';

/** 산출물·의존성·설정파일 등 린트 제외 경로 (모든 워크스페이스 공통). */
export const sharedIgnores = [
  '**/dist/**',
  '**/build/**',
  '**/.next/**',
  '**/coverage/**',
  '**/node_modules/**',
  '**/*.config.*',
];

/** 프레임워크 프리셋 위에 얹는 TriPick 공통 규칙 조정. */
export const sharedRules = {
  '@typescript-eslint/no-unused-vars': [
    'warn',
    { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
  ],
  '@typescript-eslint/no-explicit-any': 'warn',
};

/** 순수 TypeScript 패키지용 base flat config (JS + typescript-eslint 권장 규칙). */
export const baseTsConfig = tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { rules: sharedRules },
);

export { prettierConfig as prettier, globals };
