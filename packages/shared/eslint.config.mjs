// ESLint flat config for @nari-surokkha/shared.
//
// `eslint` comes from the root workspace's devDependencies and
// `typescript-eslint` is hoisted from services/api — both are in the root
// package-lock.json, so `npm ci` at the repo root provides them.
import tseslint from 'typescript-eslint';

export default tseslint.config(
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    ignores: ['dist/', 'node_modules/'],
  },
);
