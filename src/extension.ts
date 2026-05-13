import * as vscode from 'vscode';

import { ChartModel } from './helm/chartModel';
import { HelmCompletionProvider } from './providers/completion';
import { HelmDefinitionProvider } from './providers/definition';
import { HelmHoverProvider } from './providers/hover';
import { LogLevel, disposeLogger, getLogger } from './util/logger';

const SUPPORTED_LANGUAGES = ['yaml', 'helm', 'gotmpl', 'helm-template', 'tpl'];

const FILE_PATTERNS = [
    '**/templates/**/*.yaml',
    '**/templates/**/*.yml',
    '**/templates/**/*.tpl',
    '**/_helpers.tpl',
    '**/values.yaml',
    '**/values.*.yaml',
    '**/*values.yaml',
];

function buildSelector(): vscode.DocumentSelector {
    const filters: vscode.DocumentFilter[] = [];
    for (const language of SUPPORTED_LANGUAGES) {
        filters.push({ language, scheme: 'file' });
        filters.push({ language, scheme: 'untitled' });
    }
    for (const pattern of FILE_PATTERNS) {
        filters.push({ scheme: 'file', pattern });
    }
    return filters;
}

function readLogLevel(): LogLevel {
    const config = vscode.workspace.getConfiguration('helmValuesExplorer');
    return config.get<LogLevel>('logLevel', 'info') ?? 'info';
}

export function activate(context: vscode.ExtensionContext): void {
    const logger = getLogger();
    logger.setLevel(readLogLevel());
    logger.info('Helm Values Explorer activated');

    const chart = new ChartModel(logger);
    const selector = buildSelector();

    const hoverProvider = new HelmHoverProvider(chart, logger);
    const definitionProvider = new HelmDefinitionProvider(chart, logger);
    const completionProvider = new HelmCompletionProvider(chart, logger);

    context.subscriptions.push(
        vscode.languages.registerHoverProvider(selector, hoverProvider),
        vscode.languages.registerDefinitionProvider(selector, definitionProvider),
        vscode.languages.registerCompletionItemProvider(
            selector,
            completionProvider,
            '.',
            ' ',
        ),
        vscode.workspace.onDidChangeConfiguration((event) => {
            if (event.affectsConfiguration('helmValuesExplorer.logLevel')) {
                logger.setLevel(readLogLevel());
            }
        }),
        chart,
        { dispose: disposeLogger },
    );
}

export function deactivate(): void {
    // Disposables registered in `context.subscriptions` are cleaned up by VS Code.
}
