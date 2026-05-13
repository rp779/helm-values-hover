import * as assert from 'assert';

import { ValuesFileIndex, parseValuesFile } from '../helm/valuesIndex';

const SAMPLE = `# sample chart values
port: 8080
debug: false
nullable: ~
image:
  repository: nginx
  tag: latest
  pullPolicy: IfNotPresent
service:
  type: ClusterIP
  port: 80
list:
  - one
  - two
quoted:
  "weird key": value
`;

function makeIndex(content = SAMPLE): ValuesFileIndex {
    const file = parseValuesFile('/virtual/values.yaml', content, 0);
    return new ValuesFileIndex(file);
}

suite('ValuesFileIndex.lookup', () => {
    test('returns leaf for a top-level scalar', () => {
        const r = makeIndex().lookup('port');
        assert.strictEqual(r.kind, 'leaf');
        assert.strictEqual(r.value, 8080);
    });

    test('returns leaf for a boolean scalar', () => {
        const r = makeIndex().lookup('debug');
        assert.strictEqual(r.kind, 'leaf');
        assert.strictEqual(r.value, false);
    });

    test('returns leaf for an explicit null', () => {
        const r = makeIndex().lookup('nullable');
        assert.strictEqual(r.kind, 'leaf');
        assert.strictEqual(r.value, null);
    });

    test('returns leaf for a nested scalar', () => {
        const r = makeIndex().lookup('image.repository');
        assert.strictEqual(r.kind, 'leaf');
        assert.strictEqual(r.value, 'nginx');
    });

    test('returns subtree for an intermediate map key', () => {
        const r = makeIndex().lookup('image');
        assert.strictEqual(r.kind, 'subtree');
        assert.deepStrictEqual(r.value, {
            repository: 'nginx',
            tag: 'latest',
            pullPolicy: 'IfNotPresent',
        });
        assert.ok(r.rendered && r.rendered.includes('repository: nginx'));
    });

    test('treats sequences as leaves', () => {
        const r = makeIndex().lookup('list');
        assert.strictEqual(r.kind, 'leaf');
        assert.deepStrictEqual(r.value, ['one', 'two']);
    });

    test('returns missing for unknown paths', () => {
        const r = makeIndex().lookup('image.missing');
        assert.strictEqual(r.kind, 'missing');
        assert.strictEqual(r.value, undefined);
    });

    test('empty path returns the entire root as subtree', () => {
        const r = makeIndex().lookup('');
        assert.strictEqual(r.kind, 'subtree');
        assert.ok((r.value as Record<string, unknown>).image);
    });

    test('records key location with line/column for top-level keys', () => {
        const idx = makeIndex();
        const r = idx.lookup('port');
        assert.ok(r.location);
        assert.strictEqual(r.location!.line, 1);
        assert.strictEqual(r.location!.column, 0);
    });

    test('records key location for nested keys', () => {
        const idx = makeIndex();
        const r = idx.lookup('image.repository');
        assert.ok(r.location);
        assert.strictEqual(r.location!.line, 5);
        assert.strictEqual(r.location!.column, 2);
    });

    test('handles missing top-level on empty document', () => {
        const idx = makeIndex('');
        assert.strictEqual(idx.lookup('foo').kind, 'missing');
    });
});

suite('ValuesFileIndex.listChildren', () => {
    test('lists root-level keys for empty path', () => {
        const children = makeIndex().listChildren('');
        assert.deepStrictEqual(
            children.sort(),
            ['debug', 'image', 'list', 'nullable', 'port', 'quoted', 'service'].sort(),
        );
    });

    test('lists immediate children of a map key', () => {
        const children = makeIndex().listChildren('image');
        assert.deepStrictEqual(children.sort(), ['pullPolicy', 'repository', 'tag'].sort());
    });

    test('returns empty for a leaf path', () => {
        assert.deepStrictEqual(makeIndex().listChildren('port'), []);
    });

    test('returns empty for an unknown path', () => {
        assert.deepStrictEqual(makeIndex().listChildren('nope.nope'), []);
    });
});
