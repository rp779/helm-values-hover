import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

import { ChartModel } from '../helm/chartModel';
import { HelmCompletionProvider } from '../providers/completion';
import { HelmDefinitionProvider } from '../providers/definition';
import { HelmHoverProvider } from '../providers/hover';
import { Logger } from '../util/logger';

function silentLogger(): Logger {
    const l = new Logger('test');
    l.setLevel('off');
    return l;
}

function mkTempDir(prefix: string): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeFile(p: string, contents: string): void {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, contents, 'utf8');
}

interface Fixture {
    chartRoot: string;
    deploymentPath: string;
    cleanup: () => void;
}

function makeFixture(): Fixture {
    const root = mkTempDir('hve-providers-');
    const chartRoot = path.join(root, 'mychart');
    writeFile(path.join(chartRoot, 'Chart.yaml'), 'apiVersion: v2\nname: mychart\nversion: 0.1.0\n');
    writeFile(
        path.join(chartRoot, 'values.yaml'),
        [
            '# values',
            'port: 8080',
            'image:',
            '  repository: nginx',
            '  tag: latest',
            '  pullPolicy: IfNotPresent',
            'service:',
            '  type: ClusterIP',
            '  port: 80',
            '',
        ].join('\n'),
    );
    writeFile(
        path.join(chartRoot, 'prod-values.yaml'),
        ['port: 80', 'image:', '  repository: nginx', '  tag: stable', ''].join('\n'),
    );
    const deploymentPath = path.join(chartRoot, 'templates', 'deployment.yaml');
    writeFile(
        deploymentPath,
        [
            'apiVersion: apps/v1',
            'kind: Deployment',
            'spec:',
            '  template:',
            '    spec:',
            '      containers:',
            '      - image: "{{ .Values.image.repository }}:{{ .Values.image.tag }}"',
            '        ports:',
            '        - containerPort: {{ .Values.port }}',
            '        {{- if .Values.image.pullPolicy }}',
            '        imagePullPolicy: {{ .Values.image.pullPolicy | quote }}',
            '        {{- end }}',
            '        env:',
            '        - name: TYPE',
            '          value: "{{ index .Values.service.type }}"',
            '        whole_image: "{{ toYaml .Values.image | nindent 8 }}"',
            '',
        ].join('\n'),
    );
    return {
        chartRoot,
        deploymentPath,
        cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
    };
}

async function openDoc(p: string): Promise<vscode.TextDocument> {
    return vscode.workspace.openTextDocument(vscode.Uri.file(p));
}

function findOffset(text: string, needle: string, occurrence = 1): number {
    let idx = -1;
    for (let n = 0; n < occurrence; n++) {
        idx = text.indexOf(needle, idx + 1);
        if (idx === -1) {
            throw new Error(`needle not found: ${needle}`);
        }
    }
    return idx;
}

suite('HelmHoverProvider', () => {
    let fixture: Fixture;
    let chart: ChartModel;
    let provider: HelmHoverProvider;

    setup(() => {
        fixture = makeFixture();
        chart = new ChartModel(silentLogger());
        provider = new HelmHoverProvider(chart, silentLogger());
    });

    teardown(() => {
        chart.dispose();
        fixture.cleanup();
    });

    test('hovers on .Values.image.repository and shows values from all files', async () => {
        const doc = await openDoc(fixture.deploymentPath);
        const text = doc.getText();
        const off = findOffset(text, '.Values.image.repository') + '.Values.'.length + 2;
        const hover = await provider.provideHover(doc, doc.positionAt(off));
        assert.ok(hover, 'expected a hover result');
        const md = (hover!.contents[0] as vscode.MarkdownString).value;
        assert.ok(md.includes('image.repository'), `path missing from hover:\n${md}`);
        assert.ok(md.includes('nginx'), `value missing from hover:\n${md}`);
        assert.ok(md.includes('values.yaml'), `source file missing from hover:\n${md}`);
        assert.ok(md.includes('prod-values.yaml'), `prod source missing from hover:\n${md}`);
    });

    test('hovers on a parent path .Values.image and shows the subtree', async () => {
        const doc = await openDoc(fixture.deploymentPath);
        const text = doc.getText();
        // The toYaml expression contains a bare .Values.image reference.
        const off = findOffset(text, '.Values.image | nindent') + '.Values.'.length + 2;
        const hover = await provider.provideHover(doc, doc.positionAt(off));
        assert.ok(hover);
        const md = (hover!.contents[0] as vscode.MarkdownString).value;
        assert.ok(md.includes('subtree'), `expected subtree marker in:\n${md}`);
        assert.ok(md.includes('repository: nginx'), `subtree contents missing:\n${md}`);
    });

    test('hovers inside an if-statement reference', async () => {
        const doc = await openDoc(fixture.deploymentPath);
        const text = doc.getText();
        const off = findOffset(text, 'if .Values.image.pullPolicy') + 'if .Values.'.length;
        const hover = await provider.provideHover(doc, doc.positionAt(off));
        assert.ok(hover, 'expected hover inside if-statement');
        const md = (hover!.contents[0] as vscode.MarkdownString).value;
        assert.ok(md.includes('IfNotPresent'), `pullPolicy value missing in:\n${md}`);
    });

    test('returns undefined for offsets not on a .Values reference', async () => {
        const doc = await openDoc(fixture.deploymentPath);
        const hover = await provider.provideHover(doc, new vscode.Position(0, 0));
        assert.strictEqual(hover, undefined);
    });
});

suite('HelmDefinitionProvider', () => {
    let fixture: Fixture;
    let chart: ChartModel;
    let provider: HelmDefinitionProvider;

    setup(() => {
        fixture = makeFixture();
        chart = new ChartModel(silentLogger());
        provider = new HelmDefinitionProvider(chart, silentLogger());
    });

    teardown(() => {
        chart.dispose();
        fixture.cleanup();
    });

    test('jumps to the YAML key in every values file that defines the path', async () => {
        const doc = await openDoc(fixture.deploymentPath);
        const text = doc.getText();
        const off = findOffset(text, '.Values.image.tag') + '.Values.'.length + 2;
        const result = await provider.provideDefinition(doc, doc.positionAt(off));
        assert.ok(result);
        const locations = result as vscode.Location[];
        assert.strictEqual(locations.length, 2);
        const lines = locations.map((l) => `${path.basename(l.uri.fsPath)}:${l.range.start.line}`).sort();
        // values.yaml has 'tag' on line 4 (0-based), prod-values.yaml on line 3.
        assert.deepStrictEqual(lines, ['prod-values.yaml:3', 'values.yaml:4']);
    });
});

suite('HelmCompletionProvider', () => {
    let fixture: Fixture;
    let chart: ChartModel;
    let provider: HelmCompletionProvider;

    setup(() => {
        fixture = makeFixture();
        chart = new ChartModel(silentLogger());
        provider = new HelmCompletionProvider(chart, silentLogger());
    });

    teardown(() => {
        chart.dispose();
        fixture.cleanup();
    });

    test('suggests top-level keys after typing {{ .Values.', async () => {
        const tmpFile = path.join(fixture.chartRoot, 'templates', 'completion-top.yaml');
        writeFile(tmpFile, 'value: {{ .Values.\n');
        const doc = await openDoc(tmpFile);
        const line = doc.lineAt(0).text;
        const pos = new vscode.Position(0, line.length);
        const items = await provider.provideCompletionItems(doc, pos);
        const labels = items.map((i) => (typeof i.label === 'string' ? i.label : i.label.label)).sort();
        assert.ok(labels.includes('image'));
        assert.ok(labels.includes('port'));
        assert.ok(labels.includes('service'));
    });

    test('suggests nested keys after typing {{ .Values.image.', async () => {
        const tmpFile = path.join(fixture.chartRoot, 'templates', 'completion-nested.yaml');
        writeFile(tmpFile, 'value: {{ .Values.image.\n');
        const doc = await openDoc(tmpFile);
        const line = doc.lineAt(0).text;
        const pos = new vscode.Position(0, line.length);
        const items = await provider.provideCompletionItems(doc, pos);
        const labels = items.map((i) => (typeof i.label === 'string' ? i.label : i.label.label)).sort();
        assert.deepStrictEqual(labels, ['pullPolicy', 'repository', 'tag']);
    });

    test('filters by partial prefix when no trailing dot is typed', async () => {
        const tmpFile = path.join(fixture.chartRoot, 'templates', 'completion-prefix.yaml');
        writeFile(tmpFile, 'value: {{ .Values.image.r\n');
        const doc = await openDoc(tmpFile);
        const line = doc.lineAt(0).text;
        const pos = new vscode.Position(0, line.length);
        const items = await provider.provideCompletionItems(doc, pos);
        const labels = items.map((i) => (typeof i.label === 'string' ? i.label : i.label.label));
        assert.deepStrictEqual(labels, ['repository']);
    });

    test('returns no suggestions outside an open action', async () => {
        const tmpFile = path.join(fixture.chartRoot, 'templates', 'completion-outside.yaml');
        writeFile(tmpFile, 'value: foo.\n');
        const doc = await openDoc(tmpFile);
        const pos = new vscode.Position(0, 11);
        const items = await provider.provideCompletionItems(doc, pos);
        assert.deepStrictEqual(items, []);
    });
});
