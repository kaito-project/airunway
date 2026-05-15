module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    ecmaFeatures: {
      jsx: true,
    },
  },
  env: {
    browser: true,
    es2022: true,
    node: true,
  },
  plugins: ['react-hooks', 'react-refresh'],
  rules: {
    'react-hooks/exhaustive-deps': 'error',
    'react-refresh/only-export-components': [
      'error',
      { allowConstantExport: true },
    ],
  },
  ignorePatterns: [
    'dist/',
    'node_modules/',
    'coverage/',
    'frontend/dist/',
    'backend/dist/',
  ],
};
