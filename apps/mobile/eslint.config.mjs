// @ts-check
import rnConfig from '@react-native/eslint-config/flat';
import { sharedIgnores, sharedRules, prettier } from '../../eslint.config.base.mjs';

/** React Native 앱 — @react-native/eslint-config flat 프리셋 기반. */
export default [
  { ignores: [...sharedIgnores, 'android/**', 'ios/**', 'vendor/**'] },
  ...rnConfig,
  // RN 프리셋이 번들하는 eslint-plugin-ft-flow(2.0.3)는 ESLint 9 에서 제거된
  // context.getAllComments 를 호출해 JS 파일 린트 시 크래시난다. 이 프로젝트는
  // Flow 를 안 쓰고 전부 TypeScript 이므로 해당 Flow 규칙을 끈다.
  {
    rules: {
      'ft-flow/define-flow-type': 'off',
      'ft-flow/use-flow-type': 'off',
    },
  },
  // sharedRules 는 @typescript-eslint 규칙을 담고 있어, RN 프리셋이 해당 플러그인을
  // 등록하는 TS 파일에만 적용한다 (JS 파일에 적용하면 plugin not found 로 실패).
  { files: ['**/*.{ts,tsx}'], rules: sharedRules },
  prettier,
];
