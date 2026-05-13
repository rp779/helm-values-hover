import * as path from 'path';
import * as vscode from 'vscode';

import { ChartModel } from '../helm/chartModel';
import {
    LookupResult,
    ValuesFileIndex,
    languageForValue,
} from '../helm/valuesIndex';
import {
    ValuesReference,
    findValuesReferences,
    pickReferenceAtOffset,
} from '../helm/templateParser';
import { Logger } from '../util/logger';

export class HelmHoverProvider implements vscode.HoverProvider {
    constructor(private readonly chart: ChartModel, private readonly logger: Logger) {}

    async provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
    ): Promise<vscode.Hover | undefined> {
        const text = document.getText();
        const offset = document.offsetAt(position);
        const refs = findValuesReferences(text);
        const ref = pickReferenceAtOffset(refs, offset);
        if (!ref) {
            return undefined;
        }

        const valuesFiles = await this.chart.resolveForDocument(document);
        const md = new vscode.MarkdownString();
        md.isTrusted = false;

        const displayPath = displayValuesPath(ref);
        md.appendMarkdown(`**\`${displayPath}\`**\n\n`);
        md.appendMarkdown(`\`${ref.actionBody.trim()}\` &nbsp;_(in_ \`{{ ... }}\`_)_\n\n`);

        if (valuesFiles.length === 0) {
            md.appendMarkdown('_No values files were found in this chart or any parent directory._');
            return new vscode.Hover(md, refRange(document, ref));
        }

        const config = vscode.workspace.getConfiguration('helmValuesExplorer');
        const showFileNames = config.get<boolean>('showFileNames', true);

        const matches: { fileName: string; result: LookupResult }[] = [];
        for (const file of valuesFiles) {
            const idx = new ValuesFileIndex(file);
            const result = idx.lookup(ref.path);
            if (result.kind !== 'missing') {
                matches.push({ fileName: path.basename(file.path), result });
            }
        }

        if (matches.length === 0) {
            md.appendMarkdown('_Not defined in any values file._\n\n');
            const searched = valuesFiles.map((f) => path.basename(f.path)).join(', ');
            md.appendMarkdown(`Searched: ${searched}`);
            return new vscode.Hover(md, refRange(document, ref));
        }

        if (matches.length === 1) {
            const { fileName, result } = matches[0];
            if (showFileNames) {
                md.appendMarkdown(`**${fileName}**${kindSuffix(result)}\n`);
            }
            md.appendCodeblock(result.rendered ?? '', languageForValue(result.value));
        } else {
            md.appendMarkdown(`Defined in ${matches.length} files:\n\n`);
            for (const { fileName, result } of matches) {
                if (showFileNames) {
                    md.appendMarkdown(`**${fileName}**${kindSuffix(result)}\n`);
                }
                md.appendCodeblock(result.rendered ?? '', languageForValue(result.value));
            }
        }

        return new vscode.Hover(md, refRange(document, ref));
    }
}

function kindSuffix(result: LookupResult): string {
    return result.kind === 'subtree' ? ' _(subtree)_' : '';
}

export function displayValuesPath(ref: ValuesReference): string {
    const prefix = ref.rootContext ? '$.Values' : '.Values';
    return ref.path ? `${prefix}.${ref.path}` : prefix;
}

export function refRange(
    document: vscode.TextDocument,
    ref: ValuesReference,
): vscode.Range {
    return new vscode.Range(
        document.positionAt(ref.refStart),
        document.positionAt(ref.refEnd),
    );
}
