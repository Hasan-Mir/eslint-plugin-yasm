module.exports = {
    extends: ['../../.eslintrc.js'],
    env: { node: true, browser: false },
    parserOptions: {
        // This disables type-aware linting for this package only.
        // It stops ESLint from looking for a tsconfig.json for these JS files.
        project: null,
    },
};
