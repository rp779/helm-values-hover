import * as fs from 'fs';
import * as path from 'path';
import * as glob from 'fast-glob';
import * as vscode from 'vscode';

import { Logger } from '../util/logger';
import { ParsedValuesFile, parseValuesFile } from './valuesIndex';

const DEFAULT_PATTERNS = ['values.yaml', '*values.yaml', 'values.*.yaml'];

/**
 * Resolves and caches the set of Helm values files visible to a given
 * document. Discovery prefers `Chart.yaml` as the chart root, falling back to
 * walking up to the filesystem root if no chart manifest is found.
 *
 * Caching is keyed by absolute file path. File system watchers are installed
 * per file so changes invalidate the cache without losing the watcher set.
 */
export class ChartModel implements vscode.Disposable {
    private readonly cache = new Map<string, ParsedValuesFile>();
    private readonly watchers = new Map<string, vscode.FileSystemWatcher>();

    constructor(private readonly logger: Logger) {}

    /**
     * Return the ordered set of parsed values files for a document. Order is:
     *   1. Files in the chart root (or starting directory in fallback mode).
     *   2. Files in subchart directories under `<chartRoot>/charts/*`.
     *   3. In fallback (no Chart.yaml) mode, files in each ancestor directory.
     */
    async resolveForDocument(document: vscode.TextDocument): Promise<ParsedValuesFile[]> {
        const docPath = document.uri.fsPath;
        if (!docPath) {
            return [];
        }
        const startDir = path.dirname(docPath);
        const filePaths = this.discoverValueFiles(startDir);
        const files: ParsedValuesFile[] = [];
        for (const fp of filePaths) {
            const parsed = this.loadFile(fp);
            if (parsed) {
                files.push(parsed);
            }
        }
        return files;
    }

    /** Locate the closest chart root by walking up to find `Chart.yaml`. */
    findChartRoot(startDir: string): string | undefined {
        let cur = path.resolve(startDir);
        const root = path.parse(cur).root;
        while (cur && cur !== root) {
            try {
                if (fs.existsSync(path.join(cur, 'Chart.yaml'))) {
                    return cur;
                }
            } catch {
                // ignore stat errors
            }
            const parent = path.dirname(cur);
            if (parent === cur) {
                break;
            }
            cur = parent;
        }
        return undefined;
    }

    /** Enumerate values files starting at `startDir`. */
    discoverValueFiles(startDir: string): string[] {
        const patterns = this.getPatterns();
        const seen = new Set<string>();
        const out: string[] = [];

        const append = (files: string[]) => {
            for (const f of files) {
                const norm = path.resolve(f);
                if (!seen.has(norm)) {
                    seen.add(norm);
                    out.push(norm);
                }
            }
        };

        const chartRoot = this.findChartRoot(startDir);
        if (chartRoot) {
            this.logger.debug(`Chart root: ${chartRoot}`);
            append(this.globIn(chartRoot, patterns));
            // Subcharts under <chartRoot>/charts/<name>/values*.yaml
            const chartsDir = path.join(chartRoot, 'charts');
            try {
                if (fs.existsSync(chartsDir) && fs.statSync(chartsDir).isDirectory()) {
                    for (const sub of fs.readdirSync(chartsDir)) {
                        const subPath = path.join(chartsDir, sub);
                        try {
                            if (fs.statSync(subPath).isDirectory()) {
                                append(this.globIn(subPath, patterns));
                            }
                        } catch {
                            // ignore unreadable entries
                        }
                    }
                }
            } catch (err) {
                this.logger.warn(`Failed to enumerate subcharts in ${chartsDir}`, err);
            }
            return out;
        }

        // Fallback: walk up from startDir to the filesystem root.
        let cur = path.resolve(startDir);
        const fsRoot = path.parse(cur).root;
        while (cur && cur !== fsRoot) {
            append(this.globIn(cur, patterns));
            const parent = path.dirname(cur);
            if (parent === cur) {
                break;
            }
            cur = parent;
        }
        return out;
    }

    /** Load a values file, using the cache when up to date. */
    loadFile(filePath: string): ParsedValuesFile | undefined {
        try {
            const stat = fs.statSync(filePath);
            const cached = this.cache.get(filePath);
            if (cached && cached.mtimeMs === stat.mtimeMs) {
                return cached;
            }
            const content = fs.readFileSync(filePath, 'utf8');
            const parsed = parseValuesFile(filePath, content, stat.mtimeMs);
            this.cache.set(filePath, parsed);
            this.installWatcher(filePath);
            return parsed;
        } catch (err) {
            this.logger.warn(`Failed to read values file ${filePath}`, err);
            return undefined;
        }
    }

    /** Drop a single cache entry; used by the watcher and from tests. */
    invalidate(filePath: string): void {
        this.cache.delete(filePath);
    }

    dispose(): void {
        for (const w of this.watchers.values()) {
            w.dispose();
        }
        this.watchers.clear();
        this.cache.clear();
    }

    private getPatterns(): string[] {
        const config = vscode.workspace.getConfiguration('helmValuesExplorer');
        const patterns = config.get<string[]>('valueFiles');
        return patterns && patterns.length > 0 ? patterns : DEFAULT_PATTERNS;
    }

    private globIn(cwd: string, patterns: string[]): string[] {
        try {
            return glob.sync(patterns, {
                cwd,
                absolute: true,
                onlyFiles: true,
                dot: true,
                followSymbolicLinks: false,
            });
        } catch (err) {
            this.logger.warn(`Glob failure in ${cwd}`, err);
            return [];
        }
    }

    private installWatcher(filePath: string): void {
        if (this.watchers.has(filePath)) {
            return;
        }
        try {
            const dir = path.dirname(filePath);
            const base = path.basename(filePath);
            const pattern = new vscode.RelativePattern(vscode.Uri.file(dir), base);
            const watcher = vscode.workspace.createFileSystemWatcher(pattern);
            const invalidate = () => {
                this.cache.delete(filePath);
                this.logger.debug(`Cache invalidated: ${filePath}`);
            };
            watcher.onDidChange(invalidate);
            watcher.onDidCreate(invalidate);
            watcher.onDidDelete(invalidate);
            this.watchers.set(filePath, watcher);
        } catch (err) {
            this.logger.warn(`Failed to install watcher for ${filePath}`, err);
        }
    }
}
