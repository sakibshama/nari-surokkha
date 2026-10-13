import tseslint from 'typescript-eslint';

export default tseslint.config(
  // Base recommended rules
  ...tseslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Correctness rules stay as hard errors — these catch real bugs.
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/explicit-function-return-type': 'warn',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      // Fastify plugins and route modules are `async` by convention even when
      // they register synchronously; flagging every one of them adds noise, not safety.
      '@typescript-eslint/require-await': 'off',

      // `any` and its unsafe-usage family are tracked as WARNINGS, not errors.
      // Rationale: there is a known `any` debt to burn down incrementally; a
      // working typechecker/linter is needed to retype each site safely. Failing
      // CI on it would block otherwise-correct changes, so we keep the debt
      // visible (warnings) while gating CI on genuine correctness errors above.
      // Burn-down goal: drive these back to 'error' once the count reaches zero.
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unsafe-assignment': 'warn',
      '@typescript-eslint/no-unsafe-member-access': 'warn',
      '@typescript-eslint/no-unsafe-call': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      '@typescript-eslint/no-unsafe-return': 'warn',
    },
  },
  {
    ignores: ['dist/', 'coverage/', 'node_modules/', '*.config.*', 'src/__tests__/'],
  },
);
