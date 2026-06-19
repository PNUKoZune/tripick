const path = require('path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

/**
 * Metro config for pnpm monorepo.
 *
 * - watchFolders: workspace root 까지 감지해야 @tripick/types 등 workspace 패키지가 잡힌다
 * - nodeModulesPaths: mobile 로컬 + workspace root 양쪽 노출
 * - unstable_enableSymlinks: pnpm 의 symlink 트리(.pnpm/<pkg>/node_modules/<pkg>) 를 Metro 가 따라가게 한다.
 *   이게 꺼져 있으면 react-native 안의 `require('invariant')` 같은 transitive 가 해석 안 된다.
 * - unstable_enablePackageExports: package.json `exports` 필드를 metro 도 인식
 * - hierarchical lookup 은 pnpm 에선 켜둬야 sibling dep 검색이 정상 동작
 */
// pnpm 으로 풀린 RN 라이브러리들이 gradle 빌드 중에 임시 디렉터리를 생성·삭제하면서
// Metro 의 inotify watcher 가 ENOENT 로 죽는다. 네이티브 빌드 산출물은 Metro 가
// 추적할 이유가 없으므로 blockList 로 통째 차단.
const nativeBuildBlockList = /[\\/](?:android|ios)[\\/](?:build|\.cxx|\.gradle|DerivedData|Pods)[\\/].*$/;

const config = {
  watchFolders: [workspaceRoot],
  resolver: {
    nodeModulesPaths: [
      path.resolve(projectRoot, 'node_modules'),
      path.resolve(workspaceRoot, 'node_modules'),
    ],
    unstable_enableSymlinks: true,
    unstable_enablePackageExports: true,
    blockList: nativeBuildBlockList,
  },
};

module.exports = mergeConfig(getDefaultConfig(projectRoot), config);
