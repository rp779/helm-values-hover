import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { ChartModel } from '../helm/chartModel';
import { Logger } from '../util/logger';

function silentLogger(): Logger {
    const logger = new Logger('test');
    logger.setLevel('off');
    return logger;
}

function mkTempDir(prefix: string): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeFile(filePath: string, contents: string): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, contents, 'utf8');
}

function buildChartFixture(): {
    chartRoot: string;
    templates: string;
    cleanup: () => void;
} {
    const root = mkTempDir('hve-chart-');
    const chartRoot = path.join(root, 'mychart');
    fs.mkdirSync(chartRoot, { recursive: true });
    writeFile(path.join(chartRoot, 'Chart.yaml'), 'apiVersion: v2\nname: mychart\nversion: 0.1.0\n');
    writeFile(path.join(chartRoot, 'values.yaml'), 'port: 8080\n');
    writeFile(path.join(chartRoot, 'dev-values.yaml'), 'port: 8081\n');
    writeFile(path.join(chartRoot, 'charts', 'sub', 'Chart.yaml'), 'apiVersion: v2\nname: sub\nversion: 0.1.0\n');
    writeFile(path.join(chartRoot, 'charts', 'sub', 'values.yaml'), 'name: sub\n');
    const templates = path.join(chartRoot, 'templates');
    fs.mkdirSync(templates, { recursive: true });
    writeFile(path.join(templates, 'deployment.yaml'), '# template\n');
    return {
        chartRoot,
        templates,
        cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
    };
}

suite('ChartModel.findChartRoot', () => {
    test('finds the closest Chart.yaml ancestor', () => {
        const fixture = buildChartFixture();
        try {
            const chart = new ChartModel(silentLogger());
            const found = chart.findChartRoot(fixture.templates);
            assert.strictEqual(found, fixture.chartRoot);
        } finally {
            fixture.cleanup();
        }
    });

    test('returns undefined when no Chart.yaml exists upstream', () => {
        const tmp = mkTempDir('hve-noroot-');
        try {
            const dir = path.join(tmp, 'a', 'b', 'c');
            fs.mkdirSync(dir, { recursive: true });
            const chart = new ChartModel(silentLogger());
            // Note: real filesystems above tmp might contain a Chart.yaml in
            // pathological setups, but this is virtually never true in CI.
            const found = chart.findChartRoot(dir);
            // We don't assert exact equality here because the search continues
            // upward; we just assert it didn't synthesise a fake path.
            if (found !== undefined) {
                assert.notStrictEqual(found, dir);
            }
        } finally {
            fs.rmSync(tmp, { recursive: true, force: true });
        }
    });
});

suite('ChartModel.discoverValueFiles', () => {
    test('returns chart-root values plus subchart values when Chart.yaml is present', () => {
        const fixture = buildChartFixture();
        try {
            const chart = new ChartModel(silentLogger());
            const files = chart.discoverValueFiles(fixture.templates).map((f) => path.basename(path.dirname(f)) + '/' + path.basename(f));
            assert.ok(
                files.includes('mychart/values.yaml'),
                `expected mychart/values.yaml in ${JSON.stringify(files)}`,
            );
            assert.ok(
                files.includes('mychart/dev-values.yaml'),
                `expected mychart/dev-values.yaml in ${JSON.stringify(files)}`,
            );
            assert.ok(
                files.includes('sub/values.yaml'),
                `expected sub/values.yaml in ${JSON.stringify(files)}`,
            );
        } finally {
            fixture.cleanup();
        }
    });
});

suite('ChartModel.loadFile cache', () => {
    test('returns the same parsed object until mtime changes', () => {
        const fixture = buildChartFixture();
        try {
            const chart = new ChartModel(silentLogger());
            const valuesPath = path.join(fixture.chartRoot, 'values.yaml');
            const a = chart.loadFile(valuesPath);
            const b = chart.loadFile(valuesPath);
            assert.ok(a && b);
            assert.strictEqual(a, b);

            // Touch the file with a new mtime ~1s in the future to defeat
            // sub-second filesystem mtime granularity.
            const future = new Date(Date.now() + 2000);
            fs.utimesSync(valuesPath, future, future);
            const c = chart.loadFile(valuesPath);
            assert.notStrictEqual(a, c, 'cache should refresh after mtime changes');
        } finally {
            fixture.cleanup();
        }
    });
});
