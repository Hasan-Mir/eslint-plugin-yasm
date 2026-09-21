import { noDisallowedUndefinedInUpdate } from '../src/rules/no-disallowed-undefined-in-update';
import { defaultRuleTester } from './utils/rule-testers';

const RULE_NAME = 'no-disallowed-undefined-in-update';

/*
 * 2️⃣1️⃣ The rule needs real type information from `parserOptions.project`.
 * Without parser services it must bail out safely instead of throwing, so the very same snippets
 * that are reported by the type-aware suite stay unreported here.
 */
const TYPE_DEPENDENT_CODE = `
interface ProfileState {
    age: number;
}

declare function useAppState<S>(name: string): [S, (update: Partial<S>) => void];

const [, updateState] = useAppState<ProfileState>('Profile');

updateState({ age: undefined });
updateState(prev => ({ age: undefined }));
updateState(() => ({ age: void 0 }));
updateState(prev => { return { age: undefined }; });
`;

defaultRuleTester.run(`${RULE_NAME}: without type information`, noDisallowedUndefinedInUpdate, {
    valid: [TYPE_DEPENDENT_CODE],
    // Without parser services there is nothing to report, so this suite intentionally has no invalid cases.
    invalid: [],
});
