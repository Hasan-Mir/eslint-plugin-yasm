import { strictEqual } from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    noDisallowedUndefinedInUpdate,
    type MessageIds,
} from '../src/rules/no-disallowed-undefined-in-update';
import { typeAwareRuleTester } from './utils/rule-testers';

const RULE_NAME = 'no-disallowed-undefined-in-update';

/** Expected diagnostic including the full message payload, so `key`/`expectedType`/`suggestedType` are asserted. */
const errorFor = (
    key: string,
    expectedType: string,
    suggestedType: string
): { messageId: MessageIds; data: Record<string, string> } => ({
    messageId: 'disallowedUndefined',
    data: { key, expectedType, suggestedType },
});

/*
 * YASM-like hook declarations shared by the snippets.
 *
 * 💡 The updater alias is intentionally named `YasmUpdater` and not `Updater`, so that most snippets
 * exercise the hook-origin detection instead of the `Updater` type-name detection.
 * The payload parameter mirrors the real YASM shape: `Partial<State> | ((prev: State) => Partial<State>)`.
 */
const YASM_DECLARATIONS = `
type YasmUpdater<S> = (update: Partial<S> | ((prev: S) => Partial<S>)) => S;

declare function useAppState<S>(name: string): [S, YasmUpdater<S>];
declare function useYasmState<S>(name: string): [S, YasmUpdater<S>];
declare function useAppStateUpdater<S>(name: string): YasmUpdater<S>;
declare function useYasmStateUpdater<S>(name: string): YasmUpdater<S>;
`;

/** Wraps a snippet in a program that declares the YASM-like hooks above. */
const yasmCode = (source: string): string => `${YASM_DECLARATIONS}\n${source}`;

/** State used by most snippets: it mixes allowed and disallowed `undefined` declarations. */
const PROFILE_STATE = `interface ProfileState {
    title: string;
    age: number;
    score: number;
    nickname?: string;
    bio?: string | undefined;
    note: string | undefined;
    payload: unknown;
    anything: any;
    neverValue: never;
    profile: { age: number };
}`;

/** Wraps a body in a program whose `updateState` updates `ProfileState` through `useAppState`. */
const profileCode = (body: string): string =>
    yasmCode(`${PROFILE_STATE}

const [, updateState] = useAppState<ProfileState>('Profile');

${body}`);

// #region 1️⃣ Basic invalid updates

typeAwareRuleTester.run(`${RULE_NAME}: basic invalid updates`, noDisallowedUndefinedInUpdate, {
    valid: [
        {
            name: 'payload without undefined',
            code: profileCode('updateState({ age: 30 });'),
        },
        {
            name: 'payload creator function without undefined',
            code: profileCode("updateState(prev => ({ title: 'updated' }));"),
        },
    ],
    invalid: [
        {
            name: 'object payload assigning undefined to a number property',
            code: profileCode('updateState({ age: undefined });'),
            errors: [errorFor('age', 'number', 'number | undefined')],
        },
        {
            name: 'object payload assigning undefined to a string property',
            code: profileCode('updateState({ title: undefined });'),
            errors: [errorFor('title', 'string', 'string | undefined')],
        },
        {
            name: 'payload creator function with parameter',
            code: profileCode('updateState(prev => ({ age: undefined }));'),
            errors: [errorFor('age', 'number', 'number | undefined')],
        },
        {
            name: 'payload creator function without parameter',
            code: profileCode('updateState(() => ({ age: undefined }));'),
            errors: [errorFor('age', 'number', 'number | undefined')],
        },
        {
            name: 'payload creator function with a block body and a direct return',
            code: profileCode('updateState(prev => { return { age: undefined }; });'),
            errors: [errorFor('age', 'number', 'number | undefined')],
        },
        {
            name: 'void 0 as the assigned value',
            code: profileCode('updateState({ age: void 0 });'),
            errors: [errorFor('age', 'number', 'number | undefined')],
        },
    ],
});

// #endregion

// #region 2️⃣ Explicitly allowed undefined

typeAwareRuleTester.run(
    `${RULE_NAME}: explicitly allowed undefined`,
    noDisallowedUndefinedInUpdate,
    {
        valid: [
            {
                name: 'optional property declared as `string | undefined`',
                code: profileCode('updateState({ bio: undefined });'),
            },
            {
                name: 'required property declared as `string | undefined`',
                code: profileCode('updateState({ note: undefined });'),
            },
            {
                name: 'property typed as `unknown`',
                code: profileCode('updateState({ payload: undefined });'),
            },
            {
                name: 'property typed as `any`',
                code: profileCode('updateState({ anything: undefined });'),
            },
            {
                name: 'allowed undefined inside a payload creator function',
                code: profileCode(
                    'updateState(prev => ({ note: undefined, payload: undefined }));'
                ),
            },
        ],
        invalid: [
            {
                // 🔒 Locked down: `never` neither accepts `undefined` nor declares it, so assigning undefined is reported.
                name: 'property typed as `never`',
                code: profileCode('updateState({ neverValue: undefined });'),
                errors: [errorFor('neverValue', 'never', 'never | undefined')],
            },
        ],
    }
);

// #endregion

// #region 3️⃣ Optional property semantics

const OPTIONAL_STATE = `interface OptionalState {
    optionalWithoutUndefined?: number;
    optionalWithUndefined?: number | undefined;
    requiredWithoutUndefined: number;
    requiredWithUndefined: number | undefined;
}`;

const optionalCode = (body: string): string =>
    yasmCode(`${OPTIONAL_STATE}

const [, updateState] = useAppState<OptionalState>('Optional');

${body}`);

typeAwareRuleTester.run(
    `${RULE_NAME}: optional property semantics`,
    noDisallowedUndefinedInUpdate,
    {
        valid: [
            {
                name: 'optional property that explicitly declares undefined',
                code: optionalCode('updateState({ optionalWithUndefined: undefined });'),
            },
            {
                name: 'required property that explicitly declares undefined',
                code: optionalCode('updateState({ requiredWithUndefined: undefined });'),
            },
        ],
        invalid: [
            {
                // 🔒 `age?: number` accepts `undefined` in the payload type, but the declaration itself does not.
                name: 'optional property without an explicit `| undefined`',
                code: optionalCode('updateState({ optionalWithoutUndefined: undefined });'),
                // The expected type already contains `undefined`, so the suggestion must not repeat it.
                errors: [
                    errorFor(
                        'optionalWithoutUndefined',
                        'number | undefined',
                        'number | undefined'
                    ),
                ],
            },
            {
                name: 'required property without an explicit `| undefined`',
                code: optionalCode('updateState({ requiredWithoutUndefined: undefined });'),
                errors: [errorFor('requiredWithoutUndefined', 'number', 'number | undefined')],
            },
        ],
    }
);

// #endregion

// #region 4️⃣ Non-literal undefined values

const VARIABLE_STATE = `interface VariableState {
    age: number;
    title: string;
}`;

const variableCode = (body: string): string =>
    yasmCode(`${VARIABLE_STATE}

const [, updateState] = useAppState<VariableState>('Variable');

${body}`);

typeAwareRuleTester.run(
    `${RULE_NAME}: non-literal undefined values`,
    noDisallowedUndefinedInUpdate,
    {
        valid: [
            {
                name: 'shorthand property of a variable that is definitely not undefined',
                code: variableCode('const age = 42;\nupdateState({ age });'),
            },
            {
                name: 'shorthand property for an optional state property that explicitly allows undefined',
                code: profileCode(`
const bio: string | undefined = undefined;
updateState({ bio });
`),
            },
            {
                name: 'shorthand property for a required state property that explicitly allows undefined',
                code: profileCode(`
const note: string | undefined = undefined;
updateState({ note });
`),
            },
            {
                name: 'shorthand nullable property inside a payload creator',
                code: profileCode(`
const note: string | undefined = undefined;
updateState(prev => ({
    note,
}));
`),
            },
            {
                name: 'asserted undefined value',
                code: variableCode('updateState({ age: undefined as never });'),
            },
            {
                name: 'payload passed through a variable',
                code: variableCode(
                    'const patch: Partial<VariableState> = { age: undefined };\nupdateState(patch);'
                ),
            },
        ],
        invalid: [
            {
                name: 'shorthand property of an `unknown` variable',
                code: variableCode('const age: unknown = undefined;\nupdateState({ age });'),
                errors: [errorFor('age', 'number', 'number | undefined')],
            },
            {
                name: 'shorthand property of an `any` variable',
                code: variableCode('const age: any = undefined;\nupdateState({ age });'),
                errors: [errorFor('age', 'number', 'number | undefined')],
            },
            {
                name: '`any` value next to an explicit undefined',
                code: profileCode(
                    'declare const value: any;\nupdateState({ bio: undefined, title: value });'
                ),
                errors: [errorFor('title', 'string', 'string | undefined')],
            },
            {
                name: '`unknown` value next to an explicit undefined',
                code: profileCode(
                    'declare const value: unknown;\nupdateState({ bio: undefined, title: value });'
                ),
                errors: [errorFor('title', 'string', 'string | undefined')],
            },
            {
                // 🔒 Regression: a shorthand property whose variable is typed `T | undefined` is reported.
                name: 'shorthand property of a `number | undefined` variable',
                code: variableCode(
                    'const age: number | undefined = undefined;\nupdateState({ age });'
                ),
                errors: [errorFor('age', 'number', 'number | undefined')],
            },
            {
                // 🔒 Regression: a `T | undefined` variable is reported inside a payload creator function.
                name: 'variable of type T | undefined passed to non-nullable property inside callback payload',
                code: yasmCode(`
interface CompanyState {
    selectedCompanies: number[];
}
const [, setUpdate] = useAppState<CompanyState>('Company');
const selectedCompanies: number[] | undefined = undefined;

setUpdate(prev => ({
    selectedCompanies,
}));
`),
                errors: [errorFor('selectedCompanies', 'number[]', 'number[] | undefined')],
            },
            {
                name: 'explicitly nullable constant value next to an explicit undefined',
                code: variableCode(
                    'const age: number | undefined = 1;\nupdateState({ title: undefined, age });'
                ),
                errors: [
                    errorFor('title', 'string', 'string | undefined'),
                    errorFor('age', 'number', 'number | undefined'),
                ],
            },
            {
                // 🔒 Non-narrowed values that allow `undefined` are reported next to a literal `undefined`.
                name: 'non-literal value next to an explicit undefined',
                code: variableCode(
                    'declare const age: number | undefined;\nupdateState({ title: undefined, age });'
                ),
                errors: [
                    errorFor('title', 'string', 'string | undefined'),
                    errorFor('age', 'number', 'number | undefined'),
                ],
            },
            {
                name: 'expression of a possibly undefined type next to an explicit undefined',
                code: variableCode(
                    'declare function computeAge(): number | undefined;\nupdateState({ title: undefined, age: computeAge() });'
                ),
                errors: [
                    errorFor('title', 'string', 'string | undefined'),
                    errorFor('age', 'number', 'number | undefined'),
                ],
            },
            {
                name: 'explicitly typed non-shorthand value next to an explicit undefined',
                code: variableCode(
                    'declare let age: number | undefined;\nupdateState({ title: undefined, age: age });'
                ),
                errors: [
                    errorFor('title', 'string', 'string | undefined'),
                    errorFor('age', 'number', 'number | undefined'),
                ],
            },
        ],
    }
);

// #endregion

// #region 5️⃣ Property key forms

const KEY_STATE = 'interface KeyState { age: number; }';

const keyCode = (body: string): string =>
    yasmCode(`${KEY_STATE}

const [, updateState] = useAppState<KeyState>('Key');

${body}`);

typeAwareRuleTester.run(`${RULE_NAME}: property key forms`, noDisallowedUndefinedInUpdate, {
    valid: [
        {
            // 🔒 Computed keys are intentionally skipped, the rule cannot resolve the property name statically.
            name: 'computed key',
            code: keyCode("const key = 'age';\nupdateState({ [key]: undefined });"),
        },
        {
            name: 'computed literal key',
            code: keyCode("updateState({ ['age']: undefined });"),
        },
    ],
    invalid: [
        {
            name: 'identifier key',
            code: keyCode('updateState({ age: undefined });'),
            errors: [errorFor('age', 'number', 'number | undefined')],
        },
        {
            name: 'string literal key',
            code: keyCode("updateState({ 'age': undefined });"),
            errors: [errorFor('age', 'number', 'number | undefined')],
        },
    ],
});

// #endregion

// #region 6️⃣ Object / function payload forms

const FORM_STATE = 'interface FormState { age: number; }';

const formCode = (body: string): string =>
    yasmCode(`${FORM_STATE}

const [, updateState] = useAppState<FormState>('Form');

${body}`);

typeAwareRuleTester.run(`${RULE_NAME}: payload forms`, noDisallowedUndefinedInUpdate, {
    valid: [
        {
            // ⚠️ Current behavior: only an object expression returned directly by the payload function is inspected.
            name: 'block body without a directly returned object',
            code: formCode(
                'updateState(prev => { const next = { age: undefined }; return next; });'
            ),
        },
        {
            name: 'return statement nested in another statement',
            code: formCode(
                'updateState(prev => { if (prev.age > 0) { return { age: undefined }; } return {}; });'
            ),
        },
        {
            name: 'payload built by another function',
            code: formCode(
                'declare function buildPatch(): Partial<FormState>;\nupdateState(prev => buildPatch());'
            ),
        },
        {
            name: 'non-object argument',
            code: formCode("updateState('age');"),
        },
        {
            name: 'undefined argument',
            code: formCode('updateState(undefined);'),
        },
        {
            name: 'void argument',
            code: formCode('updateState(void 0);'),
        },
        {
            name: 'payload function returning a non-object',
            code: formCode('updateState(() => undefined);'),
        },
    ],
    invalid: [
        {
            name: 'function expression with a block body',
            code: formCode('updateState(function (prev) { return { age: undefined }; });'),
            errors: [errorFor('age', 'number', 'number | undefined')],
        },
        {
            name: 'function expression without parameters',
            code: formCode('updateState(function () { return { age: undefined }; });'),
            errors: [errorFor('age', 'number', 'number | undefined')],
        },
        {
            name: 'payload creator function with a block body and a direct return',
            code: formCode('updateState(prev => { return { age: undefined }; });'),
            errors: [errorFor('age', 'number', 'number | undefined')],
        },
        {
            name: 'parenthesized object payload',
            code: formCode('updateState(({ age: undefined }));'),
            errors: [errorFor('age', 'number', 'number | undefined')],
        },
    ],
});

// #endregion

// #region 7️⃣ Multiple properties

const MIXED_STATE = `interface MixedState {
    name: string;
    age: number;
    score: string | undefined;
}`;

const mixedCode = (body: string): string =>
    yasmCode(`${MIXED_STATE}

const [, updateState] = useAppState<MixedState>('Mixed');

${body}`);

typeAwareRuleTester.run(`${RULE_NAME}: multiple properties`, noDisallowedUndefinedInUpdate, {
    valid: [
        {
            name: 'only the property that allows undefined',
            code: mixedCode("updateState({ name: 'x', age: 1, score: undefined });"),
        },
    ],
    invalid: [
        {
            name: 'only the disallowed property is reported',
            code: mixedCode("updateState({ name: 'x', age: undefined, score: undefined });"),
            errors: [errorFor('age', 'number', 'number | undefined')],
        },
        {
            name: 'one report per disallowed property',
            code: mixedCode('updateState({ name: undefined, age: undefined });'),
            errors: [
                errorFor('name', 'string', 'string | undefined'),
                errorFor('age', 'number', 'number | undefined'),
            ],
        },
        {
            name: 'one report per disallowed property inside a payload creator function',
            code: mixedCode(
                "updateState(prev => ({ name: 'x', age: undefined, score: undefined }));"
            ),
            errors: [errorFor('age', 'number', 'number | undefined')],
        },
    ],
});

// #endregion

// #region 8️⃣ Argument count guard

const ARITY_DECLARATIONS = `
interface ArityState { age: number; }

type ArityUpdater<S> = (update: Partial<S>, extra: string) => S;

declare function useAppState<S>(name: string): [S, (update: Partial<S>) => void];
declare function useAppStateUpdater<S>(name: string): ArityUpdater<S>;
`;

const arityCode = (body: string): string => `${ARITY_DECLARATIONS}
const [, updateState] = useAppState<ArityState>('Arity');
const updateMain = useAppStateUpdater<ArityState>('Arity');

${body}`;

typeAwareRuleTester.run(`${RULE_NAME}: argument count guard`, noDisallowedUndefinedInUpdate, {
    valid: [
        {
            // 🔒 Only calls with exactly one argument can be updater invocations.
            name: 'call without arguments',
            code: arityCode('updateState();'),
        },
        {
            name: 'call with more than one argument',
            code: arityCode("updateMain({ age: undefined }, 'extra');"),
        },
        {
            name: 'call with a spread argument',
            code: arityCode(
                'declare const patches: [Partial<ArityState>];\nupdateState(...patches);'
            ),
        },
    ],
    invalid: [
        {
            // Control case: the same updater is recognized when it is called with a single argument.
            name: 'recognized updater called with a single argument',
            code: arityCode('updateMain({ age: undefined });'),
            errors: [errorFor('age', 'number', 'number | undefined')],
        },
    ],
});

// #endregion

// #region 9️⃣ Non-YASM callers

typeAwareRuleTester.run(`${RULE_NAME}: non-YASM callers`, noDisallowedUndefinedInUpdate, {
    valid: [
        {
            name: 'array callback returning an object with undefined',
            code: `
interface RowState { age: number; }

declare const rows: RowState[];
rows.map(row => ({ age: undefined, row }));
`,
        },
        {
            name: 'ordinary functions accepting an object',
            code: `
interface DataState { age: number; }

declare function setData(payload: Partial<DataState>): void;
declare function setDataSource(payload: Partial<DataState>): void;

setData({ age: undefined });
setDataSource({ age: undefined });
`,
        },
        {
            name: 'arbitrary function and callback APIs',
            code: `
declare function applyPatch(payload: { age: number }): void;
declare function onReady(callback: () => unknown): void;

applyPatch({ age: undefined });
onReady(() => ({ age: undefined }));
`,
        },
        {
            name: 'arbitrary method whose first argument is an object',
            code: `
interface ArbitraryState { age: number; }

interface Api {
    setField(payload: Partial<ArbitraryState>): void;
}

declare const api: Api;
api.setField({ age: undefined });
`,
        },
    ],
    // The rule must never lint every function call that contains `undefined`.
    invalid: [],
});

// #endregion

// #region 🔟 YASM updater recognition

const RECOGNITION_STATE = `interface RecordState {
    age: number;
    bio?: string | undefined;
}`;

const recognitionCode = (body: string): string =>
    yasmCode(`${RECOGNITION_STATE}

${body}`);

typeAwareRuleTester.run(`${RULE_NAME}: updater recognition`, noDisallowedUndefinedInUpdate, {
    valid: [
        {
            name: 'useAppState destructured updater with an allowed property',
            code: recognitionCode(
                "const [, updateState] = useAppState<RecordState>('Record');\nupdateState({ bio: undefined });"
            ),
        },
        {
            name: 'useYasmState destructured updater with an allowed property',
            code: recognitionCode(
                "const [, updateState] = useYasmState<RecordState>('Record');\nupdateState({ bio: undefined });"
            ),
        },
        {
            name: 'useAppStateUpdater with an allowed property',
            code: recognitionCode(
                "const updateMain = useAppStateUpdater<RecordState>('Record');\nupdateMain({ bio: undefined });"
            ),
        },
        {
            name: 'useYasmStateUpdater with an allowed property',
            code: recognitionCode(
                "const updateMain = useYasmStateUpdater<RecordState>('Record');\nupdateMain({ bio: undefined });"
            ),
        },
        {
            name: '`updater` member reference with an allowed property',
            code: recognitionCode(`interface RecordHandle {
    updater: (update: Partial<RecordState>) => RecordState;
}

declare const record: RecordHandle;
record.updater({ bio: undefined });`),
        },
        {
            name: '`Updater` typed callee with an allowed property',
            code: recognitionCode(`type Updater<S> = (update: Partial<S> | ((prev: S) => Partial<S>)) => S;

declare const updateMain: Updater<RecordState>;
updateMain({ bio: undefined });`),
        },
        {
            name: 'local `Updater` imported from an unrelated module',
            code: recognitionCode(`
import type { Updater as LocalUpdater } from './unrelated-updater';

declare const unrelated: LocalUpdater<RecordState>;

unrelated({ age: undefined });
`),
        },
    ],
    invalid: [
        {
            name: 'useAppState destructured updater',
            code: recognitionCode(
                "const [, updateState] = useAppState<RecordState>('Record');\nupdateState({ age: undefined });"
            ),
            errors: [errorFor('age', 'number', 'number | undefined')],
        },
        {
            name: 'useYasmState destructured updater',
            code: recognitionCode(
                "const [, updateState] = useYasmState<RecordState>('Record');\nupdateState({ age: undefined });"
            ),
            errors: [errorFor('age', 'number', 'number | undefined')],
        },
        {
            name: 'useAppStateUpdater updater',
            code: recognitionCode(
                "const updateMain = useAppStateUpdater<RecordState>('Record');\nupdateMain({ age: undefined });"
            ),
            errors: [errorFor('age', 'number', 'number | undefined')],
        },
        {
            name: 'useYasmStateUpdater updater',
            code: recognitionCode(
                "const updateMain = useYasmStateUpdater<RecordState>('Record');\nupdateMain({ age: undefined });"
            ),
            errors: [errorFor('age', 'number', 'number | undefined')],
        },
        {
            name: '`updater` member reference',
            code: recognitionCode(`interface RecordHandle {
    updater: (update: Partial<RecordState>) => RecordState;
}

declare const record: RecordHandle;
record.updater({ age: undefined });`),
            errors: [errorFor('age', 'number', 'number | undefined')],
        },
        {
            name: '`Updater` typed callee',
            code: recognitionCode(`type Updater<S> = (update: Partial<S> | ((prev: S) => Partial<S>)) => S;

declare const updateMain: Updater<RecordState>;
updateMain({ age: undefined });`),
            errors: [errorFor('age', 'number', 'number | undefined')],
        },
        {
            name: 'YASM `Updater` imported directly from `@mrnafisia/yasm`',
            code: recognitionCode(`
import type { Updater } from '@mrnafisia/yasm';

declare const updateMain: Updater<RecordState>;

updateMain({ age: undefined });
`),
            errors: [errorFor('age', 'number', 'number | undefined')],
        },
        {
            name: 'YASM `Updater` imported from `@mrnafisia/yasm` with local alias',
            code: recognitionCode(`
import type { Updater as RenamedUpdater } from '@mrnafisia/yasm';

declare const updateMain: RenamedUpdater<RecordState>;

updateMain({ age: undefined });
`),
            errors: [errorFor('age', 'number', 'number | undefined')],
        },
        {
            name: 'local `Updater` in a source file declaring a YASM hook',
            code: recognitionCode(`
type Updater<S> = (update: Partial<S> | ((prev: S) => Partial<S>)) => S;

declare const updateMain: Updater<RecordState>;

updateMain({ age: undefined });
`),
            errors: [errorFor('age', 'number', 'number | undefined')],
        },
    ],
});

// #endregion

// #region 1️⃣1️⃣ Custom hook names

const CUSTOM_HOOK_DECLARATIONS = `
interface CustomState {
    age: number;
    bio?: string | undefined;
}

type CustomUpdater<S> = (update: Partial<S> | ((prev: S) => Partial<S>)) => S;

declare function useCustomStateHook<S>(name: string): [S, CustomUpdater<S>];
declare function useAppState<S>(name: string): [S, CustomUpdater<S>];
`;

const customHookCode = (hookCall: string, body: string): string => `${CUSTOM_HOOK_DECLARATIONS}
${hookCall}

${body}`;

const CUSTOM_HOOK_CALL = "const [, updateState] = useCustomStateHook<CustomState>('Custom');";
const DEFAULT_HOOK_CALL = "const [, updateState] = useAppState<CustomState>('Default');";

typeAwareRuleTester.run(`${RULE_NAME}: custom hook names`, noDisallowedUndefinedInUpdate, {
    valid: [
        {
            name: 'custom hook updater with an allowed property',
            options: [{ hookNames: ['useCustomStateHook'] }],
            code: customHookCode(CUSTOM_HOOK_CALL, 'updateState({ bio: undefined });'),
        },
        {
            // 🔒 `hookNames` replaces the documented default list, so `useAppState` is no longer recognized.
            name: 'default hook updater while only a custom hook name is configured',
            options: [{ hookNames: ['useCustomStateHook'] }],
            code: customHookCode(DEFAULT_HOOK_CALL, 'updateState({ age: undefined });'),
        },
    ],
    invalid: [
        {
            name: 'custom hook updater',
            options: [{ hookNames: ['useCustomStateHook'] }],
            code: customHookCode(CUSTOM_HOOK_CALL, 'updateState({ age: undefined });'),
            errors: [errorFor('age', 'number', 'number | undefined')],
        },
        {
            // 🔒 Listing the default names next to the custom one keeps both of them recognized.
            name: 'custom hook updater with the default hook names re-listed',
            options: [{ hookNames: ['useAppState', 'useCustomStateHook'] }],
            code: customHookCode(CUSTOM_HOOK_CALL, 'updateState({ age: undefined });'),
            errors: [errorFor('age', 'number', 'number | undefined')],
        },
        {
            name: 'default hook updater with the default hook names re-listed',
            options: [{ hookNames: ['useAppState', 'useCustomStateHook'] }],
            code: customHookCode(DEFAULT_HOOK_CALL, 'updateState({ age: undefined });'),
            errors: [errorFor('age', 'number', 'number | undefined')],
        },
    ],
});

// #endregion

// #region 1️⃣2️⃣ + 1️⃣3️⃣ calleeRegex

const REGEX_DECLARATIONS = `
interface RegexState { age: number; }

declare function updateRecord(payload: Partial<RegexState>): void;
declare function applyUpdater(payload: Partial<RegexState>): void;
declare function recordUpdater(payload: Partial<RegexState>): void;
declare function setData(payload: Partial<RegexState>): void;

declare const store: {
    updateRecord(payload: Partial<RegexState>): void;
    reset(payload: Partial<RegexState>): void;
};
`;

const regexCode = (body: string): string => `${REGEX_DECLARATIONS}\n${body}`;

typeAwareRuleTester.run(`${RULE_NAME}: calleeRegex`, noDisallowedUndefinedInUpdate, {
    valid: [
        {
            name: 'non-matching identifier callee',
            options: [{ calleeRegex: '^(update.*|.*Updater)$' }],
            code: regexCode('setData({ age: undefined });'),
        },
        {
            name: 'non-matching member callee',
            options: [{ calleeRegex: '^(update.*|.*Updater)$' }],
            code: regexCode('store.reset({ age: undefined });'),
        },
        {
            // 🔒 Regexes are compiled case-insensitively, but the anchors still have to match.
            name: 'identifier callee that does not match the anchored pattern',
            options: [{ calleeRegex: '^UPDATE' }],
            code: regexCode('recordUpdater({ age: undefined });'),
        },
    ],
    invalid: [
        {
            name: 'matching identifier callee (`update*`)',
            options: [{ calleeRegex: '^(update.*|.*Updater)$' }],
            code: regexCode('updateRecord({ age: undefined });'),
            errors: [errorFor('age', 'number', 'number | undefined')],
        },
        {
            name: 'matching identifier callee (`*Updater`)',
            options: [{ calleeRegex: '^(update.*|.*Updater)$' }],
            code: regexCode('applyUpdater({ age: undefined });'),
            errors: [errorFor('age', 'number', 'number | undefined')],
        },
        {
            // 🔒 For member expressions the property name is matched, not the object expression.
            name: 'matching member callee property name',
            options: [{ calleeRegex: '^(update.*|.*Updater)$' }],
            code: regexCode('store.updateRecord({ age: undefined });'),
            errors: [errorFor('age', 'number', 'number | undefined')],
        },
        {
            // 🔒 Regexes are compiled with the case-insensitive flag.
            name: 'matching identifier callee with a lower case pattern',
            options: [{ calleeRegex: '^update' }],
            code: regexCode('updateRecord({ age: undefined });'),
            errors: [errorFor('age', 'number', 'number | undefined')],
        },
        {
            name: 'matching identifier callee with an upper case pattern',
            options: [{ calleeRegex: '^UPDATE' }],
            code: regexCode('updateRecord({ age: undefined });'),
            errors: [errorFor('age', 'number', 'number | undefined')],
        },
    ],
});

// #endregion

// #region 1️⃣4️⃣ Base state type resolution

const RESOLUTION_PREAMBLE = `type YasmUpdater<S> = (update: Partial<S> | ((prev: S) => Partial<S>)) => S;`;

typeAwareRuleTester.run(`${RULE_NAME}: base state type resolution`, noDisallowedUndefinedInUpdate, {
    valid: [
        {
            name: 'type alias state with an allowed property',
            code: `${RESOLUTION_PREAMBLE}
type AliasState = { age: number; bio?: string | undefined };

declare function useAppState<S>(name: string): [S, YasmUpdater<S>];
const [, updateState] = useAppState<AliasState>('Alias');

updateState({ bio: undefined });`,
        },
        {
            name: 'generic hook whose state is inferred from the initial value',
            code: `declare function useAppState<T extends object>(name: string, initial: T): [T, (update: Partial<T>) => void];

const [, updateState] = useAppState('Inferred', { age: 1, title: 'x' });

updateState({ age: 2 });`,
        },
    ],
    invalid: [
        {
            name: 'type alias state resolved through the contextual Partial<S>',
            code: `${RESOLUTION_PREAMBLE}
type AliasState = { age: number };

declare function useAppState<S>(name: string): [S, YasmUpdater<S>];
const [, updateState] = useAppState<AliasState>('Alias');

updateState({ age: undefined });`,
            errors: [errorFor('age', 'number', 'number | undefined')],
        },
        {
            name: 'state resolved from the payload creator parameter',
            code: `${RESOLUTION_PREAMBLE}
type CallbackState = { age: number };

declare function useAppStateUpdater<S>(name: string): (update: (prev: S) => Partial<S>) => S;
const updateMain = useAppStateUpdater<CallbackState>('Callback');

updateMain(prev => ({ age: undefined }));`,
            errors: [errorFor('age', 'number', 'number | undefined')],
        },
        {
            name: 'state resolved from an annotated payload creator parameter',
            code: `${RESOLUTION_PREAMBLE}
type AnnotatedState = { age: number };

declare function useAppStateUpdater<S>(name: string): (update: (prev: S) => Partial<S>) => S;
const updateMain = useAppStateUpdater<AnnotatedState>('Annotated');

updateMain((prev: AnnotatedState) => ({ age: undefined }));`,
            errors: [errorFor('age', 'number', 'number | undefined')],
        },
        {
            name: 'state resolved from a call signature containing Partial<S>',
            code: `${RESOLUTION_PREAMBLE}
interface SignatureState { age: number; }

interface UpdaterHandle<S> {
    (update: Partial<S>): S;
}

declare function useAppStateUpdater<S>(name: string): UpdaterHandle<S>;
const updateMain = useAppStateUpdater<SignatureState>('Signature');

updateMain({ age: undefined });`,
            errors: [errorFor('age', 'number', 'number | undefined')],
        },
        {
            name: 'generic hook whose state is inferred from the initial value',
            code: `declare function useAppState<T extends object>(name: string, initial: T): [T, (update: Partial<T>) => void];

const [, updateState] = useAppState('Inferred', { age: 1, title: 'x' });

updateState({ age: undefined });`,
            errors: [errorFor('age', 'number', 'number | undefined')],
        },
        {
            name: 'composed state type',
            code: `${RESOLUTION_PREAMBLE}
interface BaseState { age: number; }
type ComposedState = BaseState & { title: string };

declare function useAppState<S>(name: string): [S, YasmUpdater<S>];
const [, updateState] = useAppState<ComposedState>('Composed');

updateState({ age: undefined });`,
            errors: [errorFor('age', 'number', 'number | undefined')],
        },
    ],
});

// #endregion

// #region 1️⃣5️⃣ + 2️⃣0️⃣ Property declarations

const declaredCode = (stateDeclaration: string, body: string): string => `${RESOLUTION_PREAMBLE}
${stateDeclaration}

declare function useAppState<S>(name: string): [S, YasmUpdater<S>];
const [, updateState] = useAppState<DeclaredState>('Declared');

${body}`;

typeAwareRuleTester.run(`${RULE_NAME}: property declarations`, noDisallowedUndefinedInUpdate, {
    valid: [
        {
            name: 'optional property of a type alias declaring undefined',
            code: declaredCode(
                'type DeclaredState = { age?: number | undefined };',
                'updateState({ age: undefined });'
            ),
        },
        {
            name: 'optional inherited property declaring undefined',
            code: declaredCode(
                `interface BaseState { bio?: string | undefined; }
interface DeclaredState extends BaseState { title: string; }`,
                'updateState({ bio: undefined });'
            ),
        },
    ],
    invalid: [
        {
            name: 'property of a type alias',
            code: declaredCode(
                'type DeclaredState = { age: number };',
                'updateState({ age: undefined });'
            ),
            errors: [errorFor('age', 'number', 'number | undefined')],
        },
        {
            name: 'optional property of a type alias',
            code: declaredCode(
                'type DeclaredState = { age?: number };',
                'updateState({ age: undefined });'
            ),
            errors: [errorFor('age', 'number | undefined', 'number | undefined')],
        },
        {
            name: 'readonly property',
            code: declaredCode(
                'interface DeclaredState { readonly age: number; }',
                'updateState({ age: undefined });'
            ),
            errors: [errorFor('age', 'number', 'number | undefined')],
        },
        {
            name: 'inherited property',
            code: declaredCode(
                `interface BaseState { age: number; }
interface DeclaredState extends BaseState { title: string; }`,
                'updateState({ age: undefined });'
            ),
            errors: [errorFor('age', 'number', 'number | undefined')],
        },
        {
            name: 'property of merged interface declarations',
            code: declaredCode(
                `interface DeclaredState { title: string; }
interface DeclaredState { age: number; }`,
                'updateState({ age: undefined });'
            ),
            errors: [errorFor('age', 'number', 'number | undefined')],
        },
        {
            name: 'property of a class state',
            code: declaredCode(
                'class DeclaredState { age = 0; }',
                'updateState({ age: undefined });'
            ),
            errors: [errorFor('age', 'number', 'number | undefined')],
        },
        {
            name: 'property whose type is an alias of a primitive',
            code: declaredCode(
                `type Age = number;
type DeclaredState = { age: Age };`,
                'updateState({ age: undefined });'
            ),
            errors: [errorFor('age', 'number', 'number | undefined')],
        },
    ],
});

// #endregion

// #region 1️⃣6️⃣ Missing / unknown properties

const UNKNOWN_PROPERTY_STATE = `interface KnownState {
    age: number;
}`;

const unknownPropertyCode = (stateDeclaration: string, body: string): string =>
    yasmCode(`${stateDeclaration}

const [, updateState] = useAppState<KnownState>('Known');

${body}`);

typeAwareRuleTester.run(`${RULE_NAME}: unknown properties`, noDisallowedUndefinedInUpdate, {
    valid: [
        {
            // 🔒 Properties that cannot be resolved on the state type are ignored instead of being reported.
            name: 'property that does not exist on the state type',
            code: unknownPropertyCode(
                UNKNOWN_PROPERTY_STATE,
                'updateState({ unknownProperty: undefined });'
            ),
        },
        {
            name: 'unknown property inside a payload creator function',
            code: unknownPropertyCode(
                UNKNOWN_PROPERTY_STATE,
                'updateState(prev => ({ unknownProperty: undefined }));'
            ),
        },
        {
            // 🔒 Index signatures are not treated as property declarations, so unknown keys stay ignored.
            name: 'unknown property on a state type with an index signature',
            code: unknownPropertyCode(
                'interface KnownState { age: number; [key: string]: number; }',
                'updateState({ unknownProperty: undefined });'
            ),
        },
    ],
    // Unknown properties never crash the rule, they are simply skipped.
    invalid: [],
});

// #endregion

// #region 1️⃣7️⃣ Spread elements

const SPREAD_STATE = `interface SpreadState {
    age: number;
    title: string;
}`;

const spreadCode = (body: string): string =>
    yasmCode(`${SPREAD_STATE}

declare const patch: Partial<SpreadState>;

const [, updateState] = useAppState<SpreadState>('Spread');

${body}`);

typeAwareRuleTester.run(`${RULE_NAME}: spread elements`, noDisallowedUndefinedInUpdate, {
    valid: [
        {
            name: 'payload consisting only of a spread element',
            code: spreadCode('updateState({ ...patch });'),
        },
        {
            // 🔒 Only explicit property assignments are inspected, spread contents are not.
            name: 'spread object literal that contains undefined',
            code: spreadCode('updateState({ ...{ age: undefined } });'),
        },
    ],
    invalid: [
        {
            name: 'explicit undefined before a spread element',
            code: spreadCode('updateState({ age: undefined, ...patch });'),
            errors: [errorFor('age', 'number', 'number | undefined')],
        },
        {
            name: 'explicit undefined after a spread element',
            code: spreadCode('updateState({ ...patch, age: undefined });'),
            errors: [errorFor('age', 'number', 'number | undefined')],
        },
        {
            name: 'explicit undefined next to a spread object literal',
            code: spreadCode('updateState({ ...{ age: undefined }, title: undefined });'),
            errors: [errorFor('title', 'string', 'string | undefined')],
        },
    ],
});

// #endregion

// #region 1️⃣8️⃣ Nested objects

const NESTED_STATE = `interface NestedState {
    profile: { age: number };
}`;

const nestedCode = (body: string): string =>
    yasmCode(`${NESTED_STATE}

const [, updateState] = useAppState<NestedState>('Nested');

${body}`);

typeAwareRuleTester.run(`${RULE_NAME}: nested objects`, noDisallowedUndefinedInUpdate, {
    valid: [
        {
            // 🔒 Only the top level property that is updated is inspected, nested payloads are out of scope.
            name: 'nested object containing undefined',
            code: nestedCode('updateState({ profile: { age: undefined } });'),
        },
        {
            name: 'nested object without undefined',
            code: nestedCode('updateState({ profile: { age: 42 } });'),
        },
    ],
    invalid: [],
});

// #endregion

// #region 2️⃣2️⃣ Regression guards

typeAwareRuleTester.run(`${RULE_NAME}: regression guards`, noDisallowedUndefinedInUpdate, {
    valid: [
        {
            name: 'React-like state setter',
            code: `
interface ReactState { age: number; }

declare function useState<T>(initial: T): [T, (value: T) => void];

const [, setData] = useState<Partial<ReactState>>({});
setData({ age: undefined });
`,
        },
        {
            name: 'array callbacks',
            code: `
interface RowState { age: number; }

declare const rows: RowState[];
rows.map(row => ({ age: undefined, row }));
rows.forEach(row => ({ age: undefined, row }));
`,
        },
        {
            // 🔒 `.updater` member calls are recognized by name, but a payload that is not `Partial<State>`
            // leaves the rule without a base state type to inspect.
            name: 'unrelated `updater` member whose payload is not a partial state',
            code: `
interface Store {
    updater(values: { age?: number }): void;
}

declare const store: Store;
store.updater({ age: undefined });
`,
        },
        {
            // 🔒 Computed member calls are skipped, so an unrelated `record['updater'](...)` is ignored.
            name: "computed member call `record['updater']` is ignored",
            code: `
interface OtherState { age: number; }

interface RecordHandle {
    updater: (update: Partial<OtherState>) => OtherState;
}

declare const record: RecordHandle;
record['updater']({ age: undefined });
`,
        },
        {
            // `Updater` type-name detection must not treat an unrelated local type alias as a YASM updater.
            name: 'unrelated type alias named `Updater`',
            code: `
type Updater<S> = (update: Partial<S>) => void;

interface OtherState { age: number; }

declare const unrelated: Updater<OtherState>;
unrelated({ age: undefined });
`,
        },
        {
            name: 'payload where undefined is not assigned',
            code: profileCode("updateState({ age: 12, title: 'x' });"),
        },
        {
            name: 'empty payload',
            code: profileCode('updateState({});'),
        },
        {
            name: 'unsupported argument shapes',
            code: profileCode(
                "updateState([undefined]);\nupdateState('age');\nupdateState(undefined);\nupdateState(void 0);"
            ),
        },
    ],
    invalid: [
        {
            // 🔒 Locked down: any non-computed `.updater(...)` member call counts as a YASM updater, so an
            // unrelated API accepting `Partial<State>` is reported as well.
            name: 'unrelated `updater` member accepting a partial state',
            code: `
interface OtherState { age: number; }

interface Store {
    updater(values: Partial<OtherState>): void;
}

declare const store: Store;
store.updater({ age: undefined });
`,
            errors: [errorFor('age', 'number', 'number | undefined')],
        },
    ],
});

// #endregion

// #region 🧾 Rule metadata

describe(`${RULE_NAME}: rule metadata`, () => {
    it('exposes a well formed documentation URL', () => {
        strictEqual(
            noDisallowedUndefinedInUpdate.meta.docs?.url,
            'https://github.com/Hasan-Mir/eslint-plugin-yasm#no-disallowed-undefined-in-update'
        );
    });
});

// #endregion
