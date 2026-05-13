import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Extension activation', () => {
    test('extension is registered with the expected id', () => {
        const ext = vscode.extensions.getExtension('rossp.helm-values-explorer');
        assert.ok(ext, 'expected rossp.helm-values-explorer to be installed');
    });

    test('configuration contributes the expected keys', () => {
        const config = vscode.workspace.getConfiguration('helmValuesExplorer');
        assert.notStrictEqual(config.inspect('valueFiles'), undefined);
        assert.notStrictEqual(config.inspect('showFileNames'), undefined);
        assert.notStrictEqual(config.inspect('logLevel'), undefined);
    });
});
