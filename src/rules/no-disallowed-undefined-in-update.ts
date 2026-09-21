import { AST_NODE_TYPES, ESLintUtils, TSESTree } from '@typescript-eslint/utils';
import ts from 'typescript';

export type Options = [
    {
        /**
         * List of hook names that generate YASM updaters.
         * Default: ['useAppState', 'useYasmState', 'useAppStateUpdater', 'useYasmStateUpdater']
         */
        hookNames?: string[];
        /**
         * Optional regex to match callee names.
         */
        calleeRegex?: string;
    }?,
];

export type MessageIds = 'disallowedUndefined';

const createRule = ESLintUtils.RuleCreator(
    name => `https://github.com/Hasan-Mir/eslint-plugin-yasm#${name}`
);

interface ESTreeToTSNodeMap {
    get(node: TSESTree.Node): ts.Node;
}

const DEFAULT_HOOK_NAMES = [
    'useAppState',
    'useYasmState',
    'useAppStateUpdater',
    'useYasmStateUpdater',
];

const YASM_SOURCE_FILE_CACHE = new WeakMap<ts.SourceFile, boolean>();

/**
 * Determines whether a given TypeScript SourceFile is connected to YASM.
 *
 * This prevents false positives by distinguishing genuine YASM updater types
 * from arbitrary, unrelated types named `Updater` across the project.
 */
function isYasmSourceFile(sourceFile: ts.SourceFile, hookNamesSet: Set<string>): boolean {
    const cached = YASM_SOURCE_FILE_CACHE.get(sourceFile);
    if (cached !== undefined) {
        return cached;
    }

    const normalizedFileName = sourceFile.fileName.replace(/\\/g, '/');

    // 1. File path check (node_modules or local workspace package)
    if (
        /\/node_modules\/(?:@mrnafisia\/)?yasm(?:\/|$)/i.test(normalizedFileName) ||
        /(?:^|\/)(?:@mrnafisia\/)?yasm(?:\/|$)/i.test(normalizedFileName)
    ) {
        YASM_SOURCE_FILE_CACHE.set(sourceFile, true);
        return true;
    }

    // 2. Inspect top-level module statements
    for (const statement of sourceFile.statements) {
        // 2.1. Direct package imports: import ... from '@mrnafisia/yasm'
        if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
            const moduleName = statement.moduleSpecifier.text;

            if (/^(?:@mrnafisia\/)?yasm(?:\/.*)?$/i.test(moduleName)) {
                YASM_SOURCE_FILE_CACHE.set(sourceFile, true);
                return true;
            }
        }

        // 2.2. Named re-exports: export { useYasmState } from ...
        if (
            ts.isExportDeclaration(statement) &&
            statement.exportClause &&
            ts.isNamedExports(statement.exportClause)
        ) {
            for (const specifier of statement.exportClause.elements) {
                if (hookNamesSet.has(specifier.name.text)) {
                    YASM_SOURCE_FILE_CACHE.set(sourceFile, true);
                    return true;
                }
            }
        }

        // 2.3. Hook function declarations
        if (
            ts.isFunctionDeclaration(statement) &&
            statement.name &&
            hookNamesSet.has(statement.name.text)
        ) {
            YASM_SOURCE_FILE_CACHE.set(sourceFile, true);
            return true;
        }

        // 2.4. Hook variable/arrow declarations
        if (ts.isVariableStatement(statement)) {
            for (const declaration of statement.declarationList.declarations) {
                if (ts.isIdentifier(declaration.name) && hookNamesSet.has(declaration.name.text)) {
                    YASM_SOURCE_FILE_CACHE.set(sourceFile, true);
                    return true;
                }
            }
        }
    }

    YASM_SOURCE_FILE_CACHE.set(sourceFile, false);
    return false;
}

/**
 * Checks whether a type is a genuine YASM Updater type.
 * Rejects local types declared inside functions or non-YASM files.
 */
function isYasmUpdaterType(
    type: ts.Type,
    checker: ts.TypeChecker,
    hookNamesSet: Set<string>
): boolean {
    const typeSymbol = type.aliasSymbol ?? type.getSymbol();

    if (!typeSymbol) {
        return false;
    }

    let targetSymbol = typeSymbol;
    if ((typeSymbol.flags & ts.SymbolFlags.Alias) !== 0) {
        try {
            targetSymbol = checker.getAliasedSymbol(typeSymbol);
        } catch {
            targetSymbol = typeSymbol;
        }
    }

    if (targetSymbol.name !== 'Updater' && typeSymbol.name !== 'Updater') {
        return false;
    }

    const declarations = [
        ...(targetSymbol.getDeclarations() ?? []),
        ...(typeSymbol.getDeclarations() ?? []),
    ];

    return declarations.some(declaration => {
        // 🔒 Reject local types declared inside function bodies, blocks, or methods
        if (
            declaration.parent &&
            !ts.isSourceFile(declaration.parent) &&
            !ts.isModuleBlock(declaration.parent)
        ) {
            return false;
        }

        return isYasmSourceFile(declaration.getSourceFile(), hookNamesSet);
    });
}

/**
 * Checks if a TypeScript Type allows `undefined` either directly or via a union.
 * Handles `unknown` and `any` since `undefined` is assignable to them.
 */
function typeAllowsUndefined(type: ts.Type): boolean {
    if (
        (type.getFlags() & (ts.TypeFlags.Undefined | ts.TypeFlags.Unknown | ts.TypeFlags.Any)) !==
        0
    ) {
        return true;
    }

    if (type.isUnion()) {
        return type.types.some(t => {
            return typeAllowsUndefined(t);
        });
    }

    if (type.isIntersection()) {
        return type.types.some(t => {
            return typeAllowsUndefined(t);
        });
    }

    const constraint = type.getConstraint?.();
    if (constraint && constraint !== type) {
        return typeAllowsUndefined(constraint);
    }

    return false;
}

/**
 * Checks whether an AST TypeNode explicitly declared `undefined`, `unknown`, or `any`.
 */
function typeNodeExplicitlyIncludesUndefined(
    typeNode: ts.TypeNode,
    checker: ts.TypeChecker
): boolean {
    if (
        typeNode.kind === ts.SyntaxKind.UndefinedKeyword ||
        typeNode.kind === ts.SyntaxKind.UnknownKeyword ||
        typeNode.kind === ts.SyntaxKind.AnyKeyword
    ) {
        return true;
    }

    if (ts.isUnionTypeNode(typeNode)) {
        return typeNode.types.some(t => {
            return typeNodeExplicitlyIncludesUndefined(t, checker);
        });
    }

    const resolvedType = checker.getTypeFromTypeNode(typeNode);
    return typeAllowsUndefined(resolvedType);
}

/**
 * Resolves the symbol and concrete property type from a parent state type.
 */
function getPropertyType(
    baseStateType: ts.Type,
    keyName: string,
    checker: ts.TypeChecker,
    locationNode?: ts.Node
): { symbol: ts.Symbol; type: ts.Type } | null {
    const symbol = checker.getPropertyOfType(baseStateType, keyName);
    if (!symbol) {
        return null;
    }

    const decl = symbol.valueDeclaration ?? symbol.declarations?.[0];
    const targetLocation = decl ?? locationNode;
    if (!targetLocation) {
        return null;
    }

    const type = checker.getTypeOfSymbolAtLocation(symbol, targetLocation);
    return { symbol, type };
}

/**
 * Verifies if the property in the original State interface allows `undefined`.
 */
function checkPropertyAllowsUndefined(
    baseStateType: ts.Type,
    keyName: string,
    checker: ts.TypeChecker,
    locationNode?: ts.Node
): { allowsUndefined: boolean; propType: ts.Type | null } {
    const propInfo = getPropertyType(baseStateType, keyName, checker, locationNode);
    if (!propInfo) {
        return { allowsUndefined: true, propType: null };
    }

    const { symbol, type: propType } = propInfo;

    const declarations = symbol.getDeclarations() ?? [];
    for (const decl of declarations) {
        if (ts.isPropertySignature(decl) || ts.isPropertyDeclaration(decl)) {
            if (decl.questionToken) {
                if (decl.type) {
                    const explicitlyAllowed = typeNodeExplicitlyIncludesUndefined(
                        decl.type,
                        checker
                    );
                    return { allowsUndefined: explicitlyAllowed, propType };
                }
                return { allowsUndefined: true, propType };
            }

            if (decl.type && typeNodeExplicitlyIncludesUndefined(decl.type, checker)) {
                return { allowsUndefined: true, propType };
            }
        }
    }

    if (!typeAllowsUndefined(propType)) {
        return { allowsUndefined: false, propType };
    }

    return { allowsUndefined: true, propType };
}

/**
 * Unwraps `Partial<S>` to extract the underlying base state type `S`.
 */
function unwrapPartialType(type: ts.Type): ts.Type | null {
    if (type.isUnion()) {
        for (const subType of type.types) {
            const unwrapped = unwrapPartialType(subType);
            if (unwrapped) {
                return unwrapped;
            }
        }
        return null;
    }

    const sym = type.aliasSymbol ?? type.getSymbol();
    if (sym && (sym.escapedName === 'Partial' || sym.name === 'Partial')) {
        if (type.aliasTypeArguments && type.aliasTypeArguments.length > 0) {
            return type.aliasTypeArguments[0];
        }

        if ((type.getFlags() & ts.TypeFlags.Object) !== 0) {
            const objectType = type as ts.ObjectType;
            if ((objectType.objectFlags & ts.ObjectFlags.Reference) !== 0) {
                const ref = type as ts.TypeReference;
                if (ref.typeArguments && ref.typeArguments.length > 0) {
                    return ref.typeArguments[0];
                }
            }
        }
    }

    return null;
}

function isValidObjectType(type: ts.Type): boolean {
    const flags = type.getFlags();
    if ((flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.Never)) !== 0) {
        return false;
    }

    return (flags & (ts.TypeFlags.Object | ts.TypeFlags.Union | ts.TypeFlags.Intersection)) !== 0;
}

/**
 * Strictly verifies whether a callee is a genuine YASM updater.
 * Rejects standard callbacks like `array.map`, `setDataSource`, etc.
 */
function isYasmUpdaterCallee(
    callee: TSESTree.Node,
    checker: ts.TypeChecker,
    esTreeNodeToTSNodeMap: ESTreeToTSNodeMap,
    hookNamesSet: Set<string>,
    calleeRegex: RegExp | null
): boolean {
    // 1. Check custom regex pattern if provided by the user
    if (calleeRegex) {
        let calleeName: string | null = null;
        if (callee.type === AST_NODE_TYPES.Identifier) {
            calleeName = callee.name;
        } else if (
            callee.type === AST_NODE_TYPES.MemberExpression &&
            !callee.computed &&
            callee.property.type === AST_NODE_TYPES.Identifier
        ) {
            calleeName = callee.property.name;
        }

        if (calleeName && calleeRegex.test(calleeName)) {
            return true;
        }
    }

    // 2. Member calls like `record.updater(...)` or `memo[path].updater(...)`
    if (
        callee.type === AST_NODE_TYPES.MemberExpression &&
        !callee.computed &&
        callee.property.type === AST_NODE_TYPES.Identifier
    ) {
        if (callee.property.name === 'updater') {
            return true;
        }
    }

    const tsCallee = esTreeNodeToTSNodeMap.get(callee);
    if (!tsCallee) {
        return false;
    }

    // 3. Type check: only recognize `Updater` types declared by or connected to YASM.
    const calleeType = checker.getTypeAtLocation(tsCallee);
    if (isYasmUpdaterType(calleeType, checker, hookNamesSet)) {
        return true;
    }

    // 4. Hook origin inspection: was this identifier created by a YASM hook?
    const symbol = checker.getSymbolAtLocation(tsCallee);
    if (symbol?.declarations) {
        for (const decl of symbol.declarations) {
            // Case A: const [state, updateState] = useAppState(...)
            if (ts.isBindingElement(decl)) {
                const arrayBinding = decl.parent;
                if (ts.isArrayBindingPattern(arrayBinding)) {
                    const elementIndex = arrayBinding.elements.indexOf(decl);
                    if (elementIndex === 1 && ts.isVariableDeclaration(arrayBinding.parent)) {
                        const init = arrayBinding.parent.initializer;
                        if (init && ts.isCallExpression(init)) {
                            const hookName = ts.isIdentifier(init.expression)
                                ? init.expression.text
                                : ts.isPropertyAccessExpression(init.expression)
                                  ? init.expression.name.text
                                  : null;

                            if (hookName && hookNamesSet.has(hookName)) {
                                return true;
                            }

                            if (ts.isIdentifier(init.expression)) {
                                const hookSymbol = checker.getSymbolAtLocation(init.expression);
                                if (hookSymbol && (hookSymbol.flags & ts.SymbolFlags.Alias) !== 0) {
                                    try {
                                        const aliased = checker.getAliasedSymbol(hookSymbol);
                                        if (aliased && hookNamesSet.has(aliased.name)) {
                                            return true;
                                        }
                                    } catch {
                                        // Ignore alias resolution errors
                                    }
                                }
                            }
                        }
                    }
                }
            }

            // Case B: const updateMain = useAppStateUpdater(...)
            if (ts.isVariableDeclaration(decl) && decl.initializer) {
                const init = decl.initializer;
                if (ts.isCallExpression(init)) {
                    const hookName = ts.isIdentifier(init.expression)
                        ? init.expression.text
                        : ts.isPropertyAccessExpression(init.expression)
                          ? init.expression.name.text
                          : null;

                    if (hookName && hookNamesSet.has(hookName)) {
                        return true;
                    }

                    if (ts.isIdentifier(init.expression)) {
                        const hookSymbol = checker.getSymbolAtLocation(init.expression);
                        if (hookSymbol && (hookSymbol.flags & ts.SymbolFlags.Alias) !== 0) {
                            try {
                                const aliased = checker.getAliasedSymbol(hookSymbol);
                                if (aliased && hookNamesSet.has(aliased.name)) {
                                    return true;
                                }
                            } catch {
                                // Ignore alias resolution errors
                            }
                        }
                    }
                }
            }
        }
    }

    return false;
}

/**
 * Resolves the underlying base state type S.
 */
function resolveBaseStateType(
    callNode: TSESTree.CallExpression,
    firstArg: TSESTree.Node,
    checker: ts.TypeChecker,
    esTreeNodeToTSNodeMap: ESTreeToTSNodeMap
): ts.Type | null {
    const tsArgNode = esTreeNodeToTSNodeMap.get(firstArg);
    if (!tsArgNode) {
        return null;
    }

    // Path 1: Payload creator function (prev => ({ ... }))
    if (
        firstArg.type === AST_NODE_TYPES.ArrowFunctionExpression ||
        firstArg.type === AST_NODE_TYPES.FunctionExpression
    ) {
        if (firstArg.params.length > 0) {
            const tsParam = esTreeNodeToTSNodeMap.get(firstArg.params[0]);
            if (tsParam) {
                const paramType = checker.getTypeAtLocation(tsParam);
                if (isValidObjectType(paramType)) {
                    return paramType;
                }
            }
        }
    }

    // Path 2: Contextual type of the argument (Partial<S>)
    if (ts.isExpression(tsArgNode)) {
        const contextualType = checker.getContextualType(tsArgNode);
        if (contextualType) {
            const unwrapped = unwrapPartialType(contextualType);
            if (unwrapped && isValidObjectType(unwrapped)) {
                return unwrapped;
            }
        }
    }

    const tsCallee = esTreeNodeToTSNodeMap.get(callNode.callee);
    if (tsCallee) {
        // Path 3: Inspect hook destructuring: const [state, setUpdate] = useAppState(...)
        // Element 0 of the hook's returned tuple is guaranteed to be S.
        const calleeSymbol = checker.getSymbolAtLocation(tsCallee);
        if (calleeSymbol?.declarations) {
            for (const decl of calleeSymbol.declarations) {
                if (ts.isBindingElement(decl) && ts.isArrayBindingPattern(decl.parent)) {
                    const varDecl = decl.parent.parent;
                    if (ts.isVariableDeclaration(varDecl) && varDecl.initializer) {
                        const hookReturnType = checker.getTypeAtLocation(varDecl.initializer);
                        const typeRef = hookReturnType as ts.TypeReference;
                        if (typeRef.typeArguments && typeRef.typeArguments.length >= 1) {
                            const firstTupleType = typeRef.typeArguments[0];
                            if (isValidObjectType(firstTupleType)) {
                                return firstTupleType;
                            }
                        }

                        const prop0Symbol = checker.getPropertyOfType(hookReturnType, '0');
                        if (prop0Symbol) {
                            const propDecl =
                                prop0Symbol.valueDeclaration ?? prop0Symbol.declarations?.[0];
                            const prop0 = propDecl
                                ? checker.getTypeOfSymbolAtLocation(prop0Symbol, propDecl)
                                : checker.getTypeOfSymbolAtLocation(prop0Symbol, varDecl);
                            if (prop0 && isValidObjectType(prop0)) {
                                return prop0;
                            }
                        }
                    }
                }
            }
        }

        // Path 4: Callee signature inspection (extract state from (state: S) => Partial<S>)
        const calleeType = checker.getTypeAtLocation(tsCallee);
        for (const sig of calleeType.getCallSignatures()) {
            if (sig.parameters.length > 0) {
                const firstParam = sig.parameters[0];
                const paramType = checker.getTypeOfSymbolAtLocation(firstParam, tsCallee);

                const directUnwrapped = unwrapPartialType(paramType);
                if (directUnwrapped && isValidObjectType(directUnwrapped)) {
                    return directUnwrapped;
                }

                const candidates = paramType.isUnion() ? paramType.types : [paramType];
                for (const member of candidates) {
                    const memberUnwrapped = unwrapPartialType(member);
                    if (memberUnwrapped && isValidObjectType(memberUnwrapped)) {
                        return memberUnwrapped;
                    }

                    for (const callSig of member.getCallSignatures()) {
                        if (callSig.parameters.length > 0) {
                            const stateParam = callSig.parameters[0];
                            const decl = stateParam.valueDeclaration;
                            const stateType = decl
                                ? checker.getTypeOfSymbolAtLocation(stateParam, decl)
                                : checker.getTypeAtLocation(
                                      stateParam.declarations?.[0] ?? tsCallee
                                  );
                            if (stateType && isValidObjectType(stateType)) {
                                return stateType;
                            }
                        }
                    }
                }
            }
        }
    }

    return null;
}

function extractObjectExpressions(argNode: TSESTree.Node): TSESTree.ObjectExpression[] {
    if (argNode.type === AST_NODE_TYPES.ObjectExpression) {
        return [argNode];
    }

    if (
        argNode.type === AST_NODE_TYPES.ArrowFunctionExpression ||
        argNode.type === AST_NODE_TYPES.FunctionExpression
    ) {
        if (argNode.body.type === AST_NODE_TYPES.ObjectExpression) {
            return [argNode.body];
        }

        if (argNode.body.type === AST_NODE_TYPES.BlockStatement) {
            const results: TSESTree.ObjectExpression[] = [];
            for (const stmt of argNode.body.body) {
                if (
                    stmt.type === AST_NODE_TYPES.ReturnStatement &&
                    stmt.argument &&
                    stmt.argument.type === AST_NODE_TYPES.ObjectExpression
                ) {
                    results.push(stmt.argument);
                }
            }
            return results;
        }
    }

    return [];
}

function isValueUndefinedOrAllowsUndefined(
    valueNode: TSESTree.Node,
    checker: ts.TypeChecker,
    esTreeNodeToTSNodeMap: ESTreeToTSNodeMap
): boolean {
    if (valueNode.type === AST_NODE_TYPES.Identifier && valueNode.name === 'undefined') {
        return true;
    }

    if (valueNode.type === AST_NODE_TYPES.UnaryExpression && valueNode.operator === 'void') {
        return true;
    }

    const tsNode = esTreeNodeToTSNodeMap.get(valueNode);
    if (!tsNode) {
        return false;
    }

    let valType: ts.Type | undefined;

    // 🔒 Handle ShorthandPropertyAssignment: { selectedCompanies }
    // In TypeScript AST, `tsNode` is the identifier. To inspect the type of the variable
    // in scope rather than the object property definition, use getShorthandAssignmentValueSymbol.
    const shorthand = ts.isShorthandPropertyAssignment(tsNode)
        ? tsNode
        : ts.isShorthandPropertyAssignment(tsNode.parent)
          ? tsNode.parent
          : null;

    if (shorthand) {
        const valueSymbol = checker.getShorthandAssignmentValueSymbol(shorthand);
        if (valueSymbol) {
            const decl = valueSymbol.valueDeclaration ?? valueSymbol.declarations?.[0];
            valType = decl
                ? checker.getTypeOfSymbolAtLocation(valueSymbol, decl)
                : checker.getTypeAtLocation(shorthand);
        }
    }

    if (!valType) {
        valType = checker.getTypeAtLocation(tsNode);
    }

    if (
        (valType.getFlags() & (ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.Never)) !==
        0
    ) {
        return false;
    }

    return typeAllowsUndefined(valType);
}

export const noDisallowedUndefinedInUpdate = createRule<Options, MessageIds>({
    name: 'no-disallowed-undefined-in-update',
    meta: {
        type: 'problem',
        docs: {
            description:
                'Disallow explicit undefined in YASM state update payloads unless the section state type explicitly permits undefined.',
        },
        schema: [
            {
                type: 'object',
                properties: {
                    hookNames: {
                        type: 'array',
                        items: { type: 'string' },
                    },
                    calleeRegex: {
                        type: 'string',
                    },
                },
                additionalProperties: false,
            },
        ],
        messages: {
            disallowedUndefined:
                "Property '{{key}}' does not permit 'undefined' in section state (type: '{{expectedType}}'). It is only allowed when defined as '{{key}}: {{suggestedType}}'.",
        },
    },
    defaultOptions: [{}],
    create(context) {
        const parserServices = context.sourceCode.parserServices;
        if (!parserServices?.program || !parserServices.esTreeNodeToTSNodeMap) {
            return {};
        }

        const checker = parserServices.program.getTypeChecker();
        const esTreeNodeToTSNodeMap = parserServices.esTreeNodeToTSNodeMap;
        const options = context.options[0] || {};

        const hookNamesSet = new Set(options.hookNames ?? DEFAULT_HOOK_NAMES);
        const calleeRegex = options.calleeRegex ? new RegExp(options.calleeRegex, 'i') : null;

        return {
            CallExpression(node) {
                // 1. Only calls with exactly 1 argument can be updater invocations
                if (node.arguments.length !== 1) {
                    return;
                }

                const firstArg = node.arguments[0];
                const isCandidatePayload =
                    firstArg.type === AST_NODE_TYPES.ObjectExpression ||
                    firstArg.type === AST_NODE_TYPES.ArrowFunctionExpression ||
                    firstArg.type === AST_NODE_TYPES.FunctionExpression;

                if (!isCandidatePayload) {
                    return;
                }

                // 2. Strict Callee Guard: verify this is genuinely a YASM updater
                // Bails out immediately for `data.map(...)`, `setDataSource(...)`, etc.
                if (
                    !isYasmUpdaterCallee(
                        node.callee,
                        checker,
                        esTreeNodeToTSNodeMap,
                        hookNamesSet,
                        calleeRegex
                    )
                ) {
                    return;
                }

                const objectExpressions = extractObjectExpressions(firstArg);
                if (objectExpressions.length === 0) {
                    return;
                }

                // 3. Resolve Base State Type S
                const baseStateType = resolveBaseStateType(
                    node,
                    firstArg,
                    checker,
                    esTreeNodeToTSNodeMap
                );
                if (!baseStateType) {
                    return;
                }

                // 4. Verify properties
                for (const objExpr of objectExpressions) {
                    for (const prop of objExpr.properties) {
                        if (prop.type !== AST_NODE_TYPES.Property || prop.computed) {
                            continue;
                        }

                        let keyName: string | null = null;
                        if (prop.key.type === AST_NODE_TYPES.Identifier) {
                            keyName = prop.key.name;
                        } else if (
                            prop.key.type === AST_NODE_TYPES.Literal &&
                            typeof prop.key.value === 'string'
                        ) {
                            keyName = prop.key.value;
                        }

                        if (!keyName) {
                            continue;
                        }

                        const passesUndefined = isValueUndefinedOrAllowsUndefined(
                            prop.value,
                            checker,
                            esTreeNodeToTSNodeMap
                        );

                        if (!passesUndefined) {
                            continue;
                        }

                        const tsPropNode = esTreeNodeToTSNodeMap.get(prop);
                        const { allowsUndefined, propType } = checkPropertyAllowsUndefined(
                            baseStateType,
                            keyName,
                            checker,
                            tsPropNode
                        );

                        if (!allowsUndefined) {
                            const expectedTypeString = propType
                                ? checker.typeToString(propType)
                                : 'unknown';

                            // Clean formatting: prevent duplicate `| undefined`
                            const suggestedType = expectedTypeString.includes('undefined')
                                ? expectedTypeString
                                : `${expectedTypeString} | undefined`;

                            context.report({
                                node: prop.value,
                                messageId: 'disallowedUndefined',
                                data: {
                                    key: keyName,
                                    expectedType: expectedTypeString,
                                    suggestedType,
                                },
                            });
                        }
                    }
                }
            },
        };
    },
});
