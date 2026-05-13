import * as assert from 'assert';

import {
    findActions,
    findValuesReferences,
    pickReferenceAtOffset,
} from '../helm/templateParser';

suite('templateParser.findValuesReferences', () => {
    test('detects a simple .Values.path reference', () => {
        const refs = findValuesReferences('image: {{ .Values.image.repository }}');
        assert.strictEqual(refs.length, 1);
        assert.strictEqual(refs[0].path, 'image.repository');
        assert.strictEqual(refs[0].rootContext, false);
    });

    test('detects bare .Values', () => {
        const refs = findValuesReferences('config: {{ toYaml .Values | nindent 2 }}');
        assert.strictEqual(refs.length, 1);
        assert.strictEqual(refs[0].path, '');
    });

    test('detects $.Values root-context references', () => {
        const refs = findValuesReferences('{{ range .Values.list }}{{ $.Values.global.foo }}{{ end }}');
        const root = refs.find((r) => r.rootContext);
        assert.ok(root, 'expected a $.Values reference');
        assert.strictEqual(root!.path, 'global.foo');
        assert.strictEqual(root!.rootContext, true);
    });

    test('detects references inside if/with/range statements', () => {
        const text = `
{{ if .Values.enabled }}
{{ with .Values.config }}
{{ range .Values.items }}
{{ end }}{{ end }}{{ end }}
`;
        const paths = findValuesReferences(text).map((r) => r.path);
        assert.deepStrictEqual(paths, ['enabled', 'config', 'items']);
    });

    test('detects references in function arguments', () => {
        const refs = findValuesReferences('{{ printf "%s-%s" .Values.a .Values.b }}');
        assert.deepStrictEqual(
            refs.map((r) => r.path),
            ['a', 'b'],
        );
    });

    test('detects references with multi-pipe and arguments', () => {
        const refs = findValuesReferences('{{ .Values.port | default 8080 | quote }}');
        assert.strictEqual(refs.length, 1);
        assert.strictEqual(refs[0].path, 'port');
    });

    test('respects whitespace-trim markers {{- ... -}}', () => {
        const refs = findValuesReferences('{{- .Values.foo -}}');
        assert.strictEqual(refs.length, 1);
        assert.strictEqual(refs[0].path, 'foo');
    });

    test('ignores .Values inside string literals', () => {
        const refs = findValuesReferences('{{ "literal .Values.fake" }}');
        assert.strictEqual(refs.length, 0);
    });

    test('ignores .Values inside Go-template comments', () => {
        const refs = findValuesReferences('{{/* .Values.fake */}}');
        assert.strictEqual(refs.length, 0);
    });

    test('does not match identifier-prefixed Values', () => {
        const refs = findValuesReferences('{{ foo.ValuesBar }}');
        assert.strictEqual(refs.length, 0);
    });

    test('does not match .ValuesFoo (no separator)', () => {
        const refs = findValuesReferences('{{ .ValuesFoo }}');
        assert.strictEqual(refs.length, 0);
    });

    test('supports hyphenated path segments', () => {
        const refs = findValuesReferences('{{ .Values.foo-bar.baz-qux }}');
        assert.strictEqual(refs.length, 1);
        assert.strictEqual(refs[0].path, 'foo-bar.baz-qux');
    });

    test('handles a backtick-quoted raw string in body', () => {
        const refs = findValuesReferences('{{ `.Values.fake` }}');
        assert.strictEqual(refs.length, 0);
    });

    test('handles parenthesized .Values', () => {
        const refs = findValuesReferences('{{ if (eq .Values.env "prod") }}');
        assert.strictEqual(refs.length, 1);
        assert.strictEqual(refs[0].path, 'env');
    });
});

suite('templateParser.findActions', () => {
    test('skips unterminated action blocks gracefully', () => {
        const actions = findActions('{{ .Values.foo unterminated');
        assert.strictEqual(actions.length, 0);
    });

    test('flags Go-template comments via isComment', () => {
        const actions = findActions('{{/* hello */}} body {{ .Values.x }}');
        assert.strictEqual(actions.length, 2);
        assert.strictEqual(actions[0].isComment, true);
        assert.strictEqual(actions[1].isComment, false);
    });
});

suite('templateParser.pickReferenceAtOffset', () => {
    test('picks the reference whose ref range contains the offset', () => {
        const text = '{{ printf "%s" .Values.a .Values.b }}';
        const refs = findValuesReferences(text);
        const off = text.indexOf('.Values.b') + 2;
        const picked = pickReferenceAtOffset(refs, off);
        assert.ok(picked);
        assert.strictEqual(picked!.path, 'b');
    });

    test('falls back to the only reference in an action', () => {
        const text = '{{ .Values.foo | default "x" }}';
        const refs = findValuesReferences(text);
        const off = text.indexOf('default');
        const picked = pickReferenceAtOffset(refs, off);
        assert.ok(picked);
        assert.strictEqual(picked!.path, 'foo');
    });

    test('returns undefined for offsets outside any action', () => {
        const text = 'plain text {{ .Values.foo }} more';
        const refs = findValuesReferences(text);
        const picked = pickReferenceAtOffset(refs, 0);
        assert.strictEqual(picked, undefined);
    });

    test('returns undefined when an ambiguous action has multiple refs and offset is not on any', () => {
        const text = '{{ printf "%s-%s" .Values.a .Values.b }}';
        const refs = findValuesReferences(text);
        const off = text.indexOf('printf');
        const picked = pickReferenceAtOffset(refs, off);
        assert.strictEqual(picked, undefined);
    });
});
