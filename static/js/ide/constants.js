export const DROP_AREA_INDICATOR_CLASS = 'drop-area-indicator';
export const GITHUB_URL_PATTERN = /^https:\/\/github.com\/([\w-]+)\/([\w-]+)(?:\.git)?/;

export const CLANG_C_FLAGS = [
  '-O0', '-std=c11', '-O0', '-Wall', '-Werror', '-Wextra',
  '-Wno-unused-variable', '-Wno-sign-compare', '-Wno-unused-parameter',
  '-Wshadow', '-D_XOPEN_SOURCE'
];
export const CLANG_LD_FLAGS = ['-lc', '-lcs50'];
