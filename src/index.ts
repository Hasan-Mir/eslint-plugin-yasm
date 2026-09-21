import { noDisallowedUndefinedInUpdate } from './rules/no-disallowed-undefined-in-update';

export const rules = {
    'no-disallowed-undefined-in-update': noDisallowedUndefinedInUpdate,
};

export const configs = {
    // Legacy ESLint (≤ 8)
    recommended: {
        plugins: ['yasm'],
        rules: {
            'yasm/no-disallowed-undefined-in-update': 'error',
        },
    },

    // Flat Config (ESLint 9+)
    'flat/recommended': {
        files: ['**/*.{ts,tsx}'],
        plugins: {
            yasm: { rules },
        },
        rules: {
            'yasm/no-disallowed-undefined-in-update': 'error',
        },
    },
};
