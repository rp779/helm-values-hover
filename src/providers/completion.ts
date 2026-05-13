import * as path from 'path';
import * as vscode from 'vscode';

import { ChartModel } from '../helm/chartModel';
import {
    LookupResult,
    ValuesFileIndex,
    languageForValue,
    renderYaml,
} from '../helm/valuesIndex';
import { Logger } from '../util/logger';

const VALUES_TAIL_RE = /(\$?\.Values)((?:\.[A-Za-z0-9_-]*)*)$/;

export class HelmCompletionProvider implements vscode.CompletionItemProvider {
    constructor(private readonly chart: ChartModel, private readonly logger: Logger) {}

    async provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
    ): Promise<vscode.CompletionItem[]> {
        const line = document.lineAt(position.line).text;
        const before = line.substring(0, position.character);

        // Only suggest when the cursor is inside an open `{{ ... }}` action.
        const lastOpen = before.lastIndexOf('{{');
        if (lastOpen === -1) {
            return [];
        }
        const lastClose = before.lastIndexOf('}}');
        if (lastClose > lastOpen) {
            return [];
        }

        const actionPart = before.substring(lastOpen + 2);
        const match = VALUES_TAIL_RE.exec(actionPart);
        if (!match) {
            return [];
        }

        const valuesToken = match[1]; // '.Values' or '$.Values'
        const tail = match[2]; // either '' or '.foo' or '.foo.bar' or trailing '.'
        const segmentParts = tail.length > 0 ? tail.substring(1).split('.') : [];
        // tail '.foo.' splits to ['foo', ''] — last empty string means we're after a dot.
        const lastIsEmpty = tail.endsWith('.');

        let parentSegments: string[];
        let prefix: string;
        if (lastIsEmpty) {
            parentSegments = segmentParts.slice(0, -1);
            prefix = '';
        } else if (segmentParts.length === 0) {
            // Nothing after `.Values` yet; suggest top-level keys.
            parentSegments = [];
            prefix = '';
        } else {
            parentSegments = segmentParts.slice(0, -1);
            prefix = segmentParts[segmentParts.length - 1];
        }

        const parentPath = parentSegments.join('.');
        const valuesFiles = await this.chart.resolveForDocument(document);
        if (valuesFiles.length === 0) {
            return [];
        }

        // Aggregate children across all files. A key may appear in multiple
        // files; track the set of source files plus a representative result.
        type Aggregate = {
            sources: string[];
            result: LookupResult;
        };
        const aggregate = new Map<string, Aggregate>();

        for (const file of valuesFiles) {
            const idx = new ValuesFileIndex(file);
            const children = idx.listChildren(parentPath);
            for (const child of children) {
                if (prefix && !child.startsWith(prefix)) {
                    continue;
                }
                const childPath = parentPath ? `${parentPath}.${child}` : child;
                const result = idx.lookup(childPath);
                const fileName = path.basename(file.path);
                const existing = aggregate.get(child);
                if (existing) {
                    existing.sources.push(fileName);
                    if (existing.result.kind === 'subtree' && result.kind === 'leaf') {
                        existing.result = result;
                    }
                } else {
                    aggregate.set(child, { sources: [fileName], result });
                }
            }
        }

        const items: vscode.CompletionItem[] = [];
        for (const [name, agg] of aggregate.entries()) {
            const isLeaf = agg.result.kind === 'leaf';
            const item = new vscode.CompletionItem(
                name,
                isLeaf ? vscode.CompletionItemKind.Field : vscode.CompletionItemKind.Module,
            );
            item.insertText = name;
            item.detail = `Helm value (${agg.sources.join(', ')})`;
            if (isLeaf) {
                const rendered = agg.result.rendered ?? renderYaml(agg.result.value);
                const fence = languageForValue(agg.result.value);
                const md = new vscode.MarkdownString();
                md.appendCodeblock(rendered, fence);
                item.documentation = md;
            } else {
                const md = new vscode.MarkdownString();
                md.appendMarkdown('_object_\n\n');
                if (agg.result.rendered) {
                    md.appendCodeblock(agg.result.rendered, 'yaml');
                }
                item.documentation = md;
            }
            items.push(item);
        }
        // Avoid an unused-import warning when valuesToken isn't otherwise consumed.
        void valuesToken;
        return items;
    }
}
