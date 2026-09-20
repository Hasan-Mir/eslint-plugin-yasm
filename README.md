# 🧩 eslint-plugin-yasm

> Type-aware ESLint plugin for [YASM (`@mrnafisia/yasm`)](https://github.com/MRNafisiA/yasm).

Enforces compile-time exact optional property checks on YASM state updates, preventing silent runtime state corruption caused by passing explicit `undefined` to non-nullable fields.

---

## ⚠️ Requirements

**This plugin works ONLY in TypeScript projects with type-aware linting enabled.**

It relies on the TypeScript `TypeChecker` to inspect section state definitions and unwrap `Partial<S>`. It will **not** work in standard JavaScript projects or when ESLint is configured without TypeScript project type information.

---

## 📦 Installation

```bash
npm install -D eslint-plugin-yasm @typescript-eslint/parser
```

---

## ⚙️ Configuration

### Flat Config (`eslint.config.js` — ESLint 9+)

```js
import tsParser from '@typescript-eslint/parser';
import yasmPlugin from 'eslint-plugin-yasm';

export default [
    {
        files: ['**/*.{ts,tsx}'],
        languageOptions: {
            parser: tsParser,
            parserOptions: {
                // ⚠️ CRITICAL: Enable TypeScript type-aware linting
                project: true,
            },
        },
        plugins: {
            yasm: yasmPlugin,
        },
        rules: {
            'yasm/no-disallowed-undefined-in-update': 'error',
        },
    },
];
```

Or extend the recommended flat preset directly:

```js
import tsParser from '@typescript-eslint/parser';
import yasmPlugin from 'eslint-plugin-yasm';

export default [
    {
        files: ['**/*.{ts,tsx}'],
        languageOptions: {
            parser: tsParser,
            parserOptions: {
                project: true,
            },
        },
    },
    yasmPlugin.configs['flat/recommended'],
];
```

### Legacy Config (`.eslintrc.js` — ESLint ≤ 8)

```js
module.exports = {
    parser: '@typescript-eslint/parser',
    parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        // ⚠️ CRITICAL: Point to your tsconfig(s) to enable type-aware linting
        project: ['./tsconfig.json', './packages/*/tsconfig.json'],
        tsconfigRootDir: __dirname,
    },
    plugins: ['yasm'],
    rules: {
        'yasm/no-disallowed-undefined-in-update': 'error',
    },
};
```

Or extend the legacy recommended preset:

```js
module.exports = {
    extends: ['plugin:yasm/recommended'],
    parser: '@typescript-eslint/parser',
    parserOptions: {
        project: ['./tsconfig.json'],
        tsconfigRootDir: __dirname,
    },
};
```

---

## ❓ The Problem

In TypeScript projects where `exactOptionalPropertyTypes` is disabled (often required due to third-party component libraries with loose optional types), TypeScript permits passing explicit `undefined` to optional properties:

```ts
type UserState = {
    name: string;
    age: number; // 👈 NOT nullable (does not allow undefined)
};

// With exactOptionalPropertyTypes disabled, TypeScript permits this:
updateState({ age: undefined });
```

Because YASM uses Immer to shallow-merge partial payloads, `age` is overwritten with `undefined`, corrupting your state at runtime.

`eslint-plugin-yasm` resolves this by inspecting the underlying section state definition. It flags any explicit assignment of `undefined` unless the field was authored with an explicit union permitting it (e.g. `age: number | undefined`).

---

## 📏 Rules

### `yasm/no-disallowed-undefined-in-update`

Disallows explicit `undefined` in state update payloads unless the property type in the section state explicitly allows `undefined`.

#### ❌ Incorrect

```ts
type ProfileState = {
    title: string;
    age: number;
};

const [state, updateState] = useAppState('Profile', path);

updateState({ age: undefined });
updateState(prev => ({ title: undefined }));
```

#### ✅ Correct

```ts
type ProfileState = {
    title: string;
    description: string | undefined; // 👈 Explicitly permits undefined
    score: unknown; // 👈 Permits undefined as subtype of unknown
};

const [state, updateState] = useAppState('Profile', path);

// Allowed: field explicitly permits undefined
updateState({ description: undefined });
updateState({ score: undefined });

// Allowed: omitting fields leaves them untouched
updateState({ title: 'New Title' });
```

---

## 🎛️ Rule Options

```js
'yasm/no-disallowed-undefined-in-update': [
    'error',
    {
        /**
         * List of hook names recognized as YASM state hooks.
         * Default: ['useAppState', 'useYasmState', 'useAppStateUpdater', 'useYasmStateUpdater']
         */
        hookNames: ['useAppState', 'useYasmState', 'useCustomStateHook'],

        /**
         * Optional regex to match callee identifier names.
         * Default: null (matches verified YASM hook origins and `updater` references)
         */
        calleeRegex: '^(update.*|.*Updater)$',
    },
]
```

---

## ⚡ Performance & Linter Setup (Oxlint / Biome)

Because this rule performs deep semantic analysis via the TypeScript Compiler API (`TypeChecker`), it requires ESLint. Linters like Biome and Oxlint do not support TypeScript type-checker plugins.

If your project uses **Oxlint** or **Biome** for fast syntax linting, retain ESLint solely for type-aware rules in a hybrid setup:

```json
"scripts": {
    "lint": "oxlint && eslint ."
}
```
