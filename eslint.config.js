import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

/**
 * The compiler already answers "does this program make sense": `tsc --noEmit`
 * runs twice in `pnpm build`, with `strict`, `noUnusedLocals` and
 * `noUnusedParameters`. This file is for the other question — habits that
 * compile perfectly and are still wrong here.
 *
 * `strictTypeChecked` rather than the plain set, because the rule this project
 * actually needed is `no-floating-promises`, and that one only works when the
 * linter can see types. A promise nobody waits for was shipped once in phase 2
 * and found by reading, not by a tool.
 */
export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'docs/**', '.superpowers/**', 'eslint.config.js', 'vite.config.ts'],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        // Both halves of the repository, each with its own tsconfig: the client
        // one loads the DOM library, the server one does not. A list, not
        // `projectService`: the service discovers `tsconfig.json` but not
        // `tsconfig.server.json`, so every server file was a parse error.
        // This file and `vite.config.ts` are ignored: the former is plain JS,
        // the latter needs Vitest types the client tsconfig deliberately omits.
        project: ['./tsconfig.json', './tsconfig.server.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['client/**/*.tsx', 'client/**/*.ts'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
    },
  },
  {
    rules: {
      /**
       * Three rules from `strictTypeChecked` that argue with decisions this
       * project made on purpose and wrote down. Turned off with the reason, so
       * the next person does not turn them back on and spend a day on it.
       */

      // 58 hits. `return startClock()` and `() => listeners.delete(listener)`
      // are how this codebase returns a teardown. Nothing here is confusing
      // about them, and the alternative is a braces-and-semicolon ritual.
      '@typescript-eslint/no-confusing-void-expression': 'off',

      // 24 hits, all of them the seam CLAUDE.md describes: every repository
      // method is `async` although `localStorage` is not, so a server
      // implementation can replace it without touching a call site. The rule
      // is right in general and wrong about this design.
      '@typescript-eslint/require-await': 'off',

      // 17 hits, every one a number in a template: `listening on ${port}`.
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
    },
  },
  {
    // Tests arrange broken input on purpose: a row that is not a row, a reply
    // that is not a reply. Insisting on perfect types there would mean writing
    // the arrangement as a lie.
    files: ['**/*.test.ts', '**/*.test.tsx', 'client/**/testing/**', 'server/testing/**'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      // Destructuring to drop a field leaves a binding nothing reads.
      '@typescript-eslint/no-unused-vars': ['error', { varsIgnorePattern: '^_' }],
      // `expect(crypto.randomUUID)` and `vi.spyOn(Storage.prototype, 'setItem')`
      // pass method references on purpose; rebinding them would change nothing
      // and the alternative is noise in every spy and property assertion.
      '@typescript-eslint/unbound-method': 'off',
    },
  },
);
