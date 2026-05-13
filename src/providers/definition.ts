import * as vscode from 'vscode';

import { ChartModel } from '../helm/chartModel';
import { ValuesFileIndex } from '../helm/valuesIndex';
import {
    findValuesReferences,
    pickReferenceAtOffset,
} from '../helm/templateParser';
import { Logger } from '../util/logger';

export class HelmDefinitionProvider implements vscode.DefinitionProvider {
    constructor(private readonly chart: ChartModel, private readonly logger: Logger) {}

    async provideDefinition(
        document: vscode.TextDocument,
        position: vscode.Position,
    ): Promise<vscode.Definition | undefined> {
        const text = document.getText();
        const offset = document.offsetAt(position);
        const refs = findValuesReferences(text);
        const ref = pickReferenceAtOffset(refs, offset);
        if (!ref) {
            return undefined;
        }

        const valuesFiles = await this.chart.resolveForDocument(document);
        const locations: vscode.Location[] = [];
        for (const file of valuesFiles) {
            const idx = new ValuesFileIndex(file);
            const result = idx.lookup(ref.path);
            const loc = result.location;
            if (!loc) {
                continue;
            }
            locations.push(
                new vscode.Location(
                    vscode.Uri.file(loc.file),
                    new vscode.Range(loc.line, loc.column, loc.endLine, loc.endColumn),
                ),
            );
        }
        return locations.length > 0 ? locations : undefined;
    }
}
