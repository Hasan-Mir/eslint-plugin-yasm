import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { after, describe, it } from 'node:test';
import tsParser from '@typescript-eslint/parser';
import { RuleTester } from '@typescript-eslint/rule-tester';

/*
 * 🧪 The `no-disallowed-undefined-in-update` rule inspects the TypeScript `TypeChecker`,
 * so every test needs real `parserOptions.project` parser services.
 *
 * `@typescript-eslint/rule-tester` lints the in-memory `code` of a test case, but the parser
 * only serves type information for files that belong to the configured project, therefore the
 * snippets are linted as a real (placeholder) file of a temporary fixture project.
 *
 * 💡 The fixture directory is process specific because `node --test` runs the test files in
 * parallel processes which would otherwise replace each other's project on disk.
 */
const FIXTURE_DIRECTORY = path.join(os.tmpdir(), `eslint-plugin-yasm-rule-tester-${process.pid}`);

/** The single placeholder file that every test case is linted as. */
export const typeAwareFilename = 'state.ts';

const FIXTURE_TSCONFIG = {
    compilerOptions: {
        strict: true,
        target: 'ES2020',
        moduleResolution: 'node',
        skipLibCheck: true,
    },
    include: ['*.ts'],
};

const createFixtureProject = (): void => {
    fs.rmSync(FIXTURE_DIRECTORY, { recursive: true, force: true });
    fs.mkdirSync(FIXTURE_DIRECTORY, { recursive: true });
    fs.writeFileSync(
        path.join(FIXTURE_DIRECTORY, 'tsconfig.json'),
        `${JSON.stringify(FIXTURE_TSCONFIG, null, 4)}\n`
    );
    fs.writeFileSync(
        path.join(FIXTURE_DIRECTORY, typeAwareFilename),
        '// 🧪 Placeholder file. RuleTester lints the in-memory code of the test cases under this real path.\n'
    );
    const yasmPackageDirectory = path.join(FIXTURE_DIRECTORY, 'node_modules', '@mrnafisia', 'yasm');
    fs.mkdirSync(yasmPackageDirectory, { recursive: true });
    fs.writeFileSync(
        path.join(yasmPackageDirectory, 'package.json'),
        `${JSON.stringify({ name: '@mrnafisia/yasm', types: './index.d.ts' }, null, 4)}\n`
    );
    fs.writeFileSync(
        path.join(yasmPackageDirectory, 'index.d.ts'),
        'export type Updater<S> = (update: Partial<S> | ((prev: S) => Partial<S>)) => S;\n'
    );
    fs.writeFileSync(
        path.join(FIXTURE_DIRECTORY, 'unrelated-updater.ts'),
        `export type Updater<S> = (update: Partial<S>) => S;\n`
    );
};

createFixtureProject();

after(() => {
    try {
        fs.rmSync(FIXTURE_DIRECTORY, { recursive: true, force: true });
    } catch {
        // The operating system cleans up its temporary directory, so a locked file is not a failure.
    }
});

/*
 * `node:test` is the runner of this package, so the rule tester has to be wired to it.
 * This has to happen before the first `RuleTester` instance is created.
 */
RuleTester.afterAll = after;
RuleTester.describe = describe;
RuleTester.it = it;

/** Rule tester with real type information from a `tsconfig.json` fixture project. */
export const typeAwareRuleTester = new RuleTester({
    defaultFilenames: { ts: typeAwareFilename, tsx: typeAwareFilename },
    languageOptions: {
        parser: tsParser,
        parserOptions: {
            project: './tsconfig.json',
            tsconfigRootDir: FIXTURE_DIRECTORY,
        },
    },
});

/** Rule tester without type information, used to verify the rule's parser-services guard. */
export const defaultRuleTester = new RuleTester();
