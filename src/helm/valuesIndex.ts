import {
    Document,
    LineCounter,
    Node,
    Pair,
    isMap,
    isPair,
    isScalar,
    isSeq,
    parseDocument,
    stringify,
} from 'yaml';

export type LookupKind = 'leaf' | 'subtree' | 'missing';

export interface KeyLocation {
    file: string;
    /** 0-based line of the matched key. */
    line: number;
    /** 0-based column of the matched key. */
    column: number;
    /** 0-based exclusive end line. */
    endLine: number;
    /** 0-based exclusive end column. */
    endColumn: number;
}

export interface LookupResult {
    kind: LookupKind;
    /** Plain JS value for leaves; subtree object for non-leaves; undefined for misses. */
    value?: unknown;
    /** YAML rendering of `value` (always present for leaf/subtree). */
    rendered?: string;
    /** Location of the matched key in the source file. */
    location?: KeyLocation;
}

export interface ParsedValuesFile {
    path: string;
    content: string;
    document: Document;
    lineCounter: LineCounter;
    /** Modification time when this snapshot was loaded. */
    mtimeMs: number;
}

export function parseValuesFile(
    filePath: string,
    content: string,
    mtimeMs: number,
): ParsedValuesFile {
    const lineCounter = new LineCounter();
    const document = parseDocument(content, { lineCounter, keepSourceTokens: false });
    return { path: filePath, content, document, lineCounter, mtimeMs };
}

/**
 * View into a single parsed values file. Cheap to construct; holds no extra
 * state beyond the parsed document.
 */
export class ValuesFileIndex {
    constructor(private readonly file: ParsedValuesFile) {}

    get path(): string {
        return this.file.path;
    }

    /**
     * Look up a dotted path. Returns:
     *   - `leaf`     for scalars / arrays / null,
     *   - `subtree`  for maps,
     *   - `missing`  if the path doesn't exist.
     *
     * An empty `path` returns the entire root document as a subtree.
     */
    lookup(path: string): LookupResult {
        const segments = path === '' ? [] : path.split('.');
        const root = this.file.document.contents;
        if (root === null || root === undefined) {
            return { kind: 'missing' };
        }

        let node: Node | null = root as Node;
        let keyRange: [number, number, number] | undefined;
        let valueRange: [number, number, number] | undefined = (root as Node).range as
            | [number, number, number]
            | undefined;

        for (const seg of segments) {
            if (!isMap(node)) {
                return { kind: 'missing' };
            }
            const items = node.items as Pair[];
            let foundPair: Pair | undefined;
            for (const item of items) {
                if (isPair(item) && getKeyString(item.key) === seg) {
                    foundPair = item;
                    break;
                }
            }
            if (!foundPair) {
                return { kind: 'missing' };
            }
            const keyNode = foundPair.key as Node | null;
            keyRange = (keyNode?.range as [number, number, number]) ?? undefined;
            node = (foundPair.value as Node | null) ?? null;
            valueRange = (node?.range as [number, number, number]) ?? keyRange;
        }

        const isLeaf = node === null || isScalar(node) || isSeq(node);
        const value = node === null ? null : (node as { toJSON?: () => unknown }).toJSON?.() ?? null;
        const rendered = renderYaml(value);
        const location = locationFromRange(this.file, keyRange ?? valueRange);

        return {
            kind: isLeaf ? 'leaf' : 'subtree',
            value,
            rendered,
            location,
        };
    }

    /**
     * List the immediate child keys of `path` (empty `path` returns root keys).
     * Returns an empty array if `path` doesn't resolve to a map.
     */
    listChildren(path: string): string[] {
        const segments = path === '' ? [] : path.split('.');
        let node: Node | null = (this.file.document.contents as Node | null) ?? null;
        for (const seg of segments) {
            if (!isMap(node)) {
                return [];
            }
            const items = node.items as Pair[];
            let foundPair: Pair | undefined;
            for (const item of items) {
                if (isPair(item) && getKeyString(item.key) === seg) {
                    foundPair = item;
                    break;
                }
            }
            if (!foundPair) {
                return [];
            }
            node = (foundPair.value as Node | null) ?? null;
        }
        if (!isMap(node)) {
            return [];
        }
        const keys: string[] = [];
        for (const item of node.items as Pair[]) {
            if (!isPair(item)) {
                continue;
            }
            const k = getKeyString(item.key);
            if (k !== undefined) {
                keys.push(k);
            }
        }
        return keys;
    }
}

function getKeyString(keyNode: unknown): string | undefined {
    if (keyNode === null || keyNode === undefined) {
        return undefined;
    }
    if (typeof keyNode === 'string' || typeof keyNode === 'number' || typeof keyNode === 'boolean') {
        return String(keyNode);
    }
    if (isScalar(keyNode as Node)) {
        const v = (keyNode as { value: unknown }).value;
        return v === null || v === undefined ? undefined : String(v);
    }
    return undefined;
}

function locationFromRange(
    file: ParsedValuesFile,
    range: [number, number, number] | undefined,
): KeyLocation | undefined {
    if (!range) {
        return undefined;
    }
    const [start, , end] = range;
    const startPos = file.lineCounter.linePos(start);
    const endPos = file.lineCounter.linePos(end);
    return {
        file: file.path,
        line: Math.max(0, startPos.line - 1),
        column: Math.max(0, startPos.col - 1),
        endLine: Math.max(0, endPos.line - 1),
        endColumn: Math.max(0, endPos.col - 1),
    };
}

/**
 * Render a JS value as YAML for hover display. Single-line scalars come back
 * unquoted (e.g. `nginx`, `8080`); maps and arrays are rendered as
 * indented YAML.
 */
export function renderYaml(value: unknown): string {
    if (value === null || value === undefined) {
        return 'null';
    }
    if (typeof value === 'string') {
        return value;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
        return String(value);
    }
    return stringify(value).trimEnd();
}

/**
 * Suggested fenced-code language tag for a hover code block.
 */
export function languageForValue(value: unknown): string {
    if (value === null || value === undefined) {
        return 'text';
    }
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        return 'text';
    }
    return 'yaml';
}
