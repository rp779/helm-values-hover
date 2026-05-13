// Tokenizer for Helm/Go-template `{{ ... }}` actions that extracts every
// `.Values.x.y` and `$.Values.x.y` reference, regardless of the surrounding
// construct (if/with/range/function calls/multi-pipe/parens).
//
// This intentionally does NOT try to be a full Go-template parser. We just
// walk action bodies, respect string literals and comments, and collect
// `.Values` / `$.Values` references.

export interface ActionBlock {
    /** Offset of the opening `{{` in the document. */
    fullStart: number;
    /** Offset just past the closing `}}` in the document. */
    fullEnd: number;
    /** Offset of the first character inside `{{` (after any optional `-`). */
    bodyStart: number;
    /** Offset of the closing `}}` (exclusive). */
    bodyEnd: number;
    /** Body text between bodyStart and bodyEnd. */
    body: string;
    /** True for `{{/&#42; ... &#42;/}}` Go-template comments. */
    isComment: boolean;
}

export interface ValuesReference {
    /** Dotted path after `.Values`. Empty string for bare `.Values`. */
    path: string;
    /** True for `$.Values...` (root-context reference). */
    rootContext: boolean;
    /** Offset of the `.` in `.Values` (or `$` in `$.Values`) within the document. */
    refStart: number;
    /** Offset just past the last path segment within the document. */
    refEnd: number;
    /** Containing action range. */
    actionStart: number;
    actionEnd: number;
    /** Full action body for display in hover. */
    actionBody: string;
}

const ID_CHAR = /[A-Za-z0-9_]/;
const PATH_SEG_CHAR = /[A-Za-z0-9_-]/;

/**
 * Scan `text` for top-level `{{ ... }}` actions. Respects `"..."` and
 * `` `...` `` string literals inside actions and recognizes
 * `{{/&#42; ... &#42;/}}` comments.
 */
export function findActions(text: string): ActionBlock[] {
    const actions: ActionBlock[] = [];
    let i = 0;
    const n = text.length;
    while (i < n - 1) {
        if (text[i] !== '{' || text[i + 1] !== '{') {
            i++;
            continue;
        }
        const fullStart = i;
        i += 2;
        // Optional whitespace-trim marker: `{{- `
        if (text[i] === '-') {
            i++;
        }
        const bodyStart = i;

        // Check for comment opener `/*`
        const isComment = text[i] === '/' && text[i + 1] === '*';

        let inString: '"' | '`' | null = null;
        let bodyEnd = -1;
        let fullEnd = -1;

        while (i < n - 1) {
            const c = text[i];
            if (inString) {
                if (c === '\\' && inString === '"' && i + 1 < n) {
                    i += 2;
                    continue;
                }
                if (c === inString) {
                    inString = null;
                }
                i++;
                continue;
            }
            if (c === '"' || c === '`') {
                inString = c as '"' | '`';
                i++;
                continue;
            }
            // Closing `}}` (with optional preceding `-`)
            if (c === '-' && text[i + 1] === '}' && text[i + 2] === '}') {
                bodyEnd = i;
                fullEnd = i + 3;
                i = fullEnd;
                break;
            }
            if (c === '}' && text[i + 1] === '}') {
                bodyEnd = i;
                fullEnd = i + 2;
                i = fullEnd;
                break;
            }
            i++;
        }

        if (bodyEnd === -1) {
            // Unterminated action; bail and skip past the opener.
            i = fullStart + 2;
            continue;
        }

        actions.push({
            fullStart,
            fullEnd,
            bodyStart,
            bodyEnd,
            body: text.substring(bodyStart, bodyEnd),
            isComment,
        });
    }
    return actions;
}

/**
 * Find every `.Values.x.y` / `$.Values.x.y` reference in `text`.
 *
 * References inside string literals or `/&#42; ... &#42;/` comments are skipped.
 */
export function findValuesReferences(text: string): ValuesReference[] {
    const refs: ValuesReference[] = [];
    for (const action of findActions(text)) {
        if (action.isComment) {
            continue;
        }
        collectFromBody(action, refs);
    }
    return refs;
}

function collectFromBody(action: ActionBlock, out: ValuesReference[]): void {
    const body = action.body;
    const baseOffset = action.bodyStart;
    const n = body.length;
    let i = 0;
    let inString: '"' | '`' | null = null;

    while (i < n) {
        const c = body[i];

        if (inString) {
            if (c === '\\' && inString === '"' && i + 1 < n) {
                i += 2;
                continue;
            }
            if (c === inString) {
                inString = null;
            }
            i++;
            continue;
        }
        if (c === '"' || c === '`') {
            inString = c as '"' | '`';
            i++;
            continue;
        }

        // Word-boundary check: previous char must not be an identifier char,
        // otherwise `foo.Values` would falsely match the `.Values` substring.
        const prev = i > 0 ? body[i - 1] : ' ';
        if (ID_CHAR.test(prev)) {
            i++;
            continue;
        }

        let cursor: number;
        let rootContext: boolean;
        if (body.startsWith('$.Values', i)) {
            cursor = i + '$.Values'.length;
            rootContext = true;
        } else if (body.startsWith('.Values', i)) {
            cursor = i + '.Values'.length;
            rootContext = false;
        } else {
            i++;
            continue;
        }

        // Reject e.g. `.ValuesFoo` (more identifier chars after `Values`).
        if (cursor < n && ID_CHAR.test(body[cursor])) {
            i++;
            continue;
        }

        const segments: string[] = [];
        let j = cursor;
        while (j < n && body[j] === '.') {
            const segStart = j + 1;
            let k = segStart;
            while (k < n && PATH_SEG_CHAR.test(body[k])) {
                k++;
            }
            if (k === segStart) {
                break;
            }
            segments.push(body.substring(segStart, k));
            j = k;
        }

        out.push({
            path: segments.join('.'),
            rootContext,
            refStart: baseOffset + i,
            refEnd: baseOffset + j,
            actionStart: action.fullStart,
            actionEnd: action.fullEnd,
            actionBody: body,
        });
        i = j;
    }
}

/**
 * Pick the most relevant reference for a cursor offset.
 *
 * Priority:
 *   1. The reference whose own range (`refStart..refEnd`) contains the offset.
 *   2. If the offset is inside an action with a single reference, that reference.
 *   3. Otherwise undefined.
 */
export function pickReferenceAtOffset(
    refs: ValuesReference[],
    offset: number,
): ValuesReference | undefined {
    let containingAction: ValuesReference[] | undefined;
    for (const ref of refs) {
        if (offset >= ref.refStart && offset <= ref.refEnd) {
            return ref;
        }
        if (offset >= ref.actionStart && offset <= ref.actionEnd) {
            if (!containingAction) {
                containingAction = [];
            }
            containingAction.push(ref);
        }
    }
    if (containingAction && containingAction.length === 1) {
        return containingAction[0];
    }
    return undefined;
}
