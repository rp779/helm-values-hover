import * as vscode from 'vscode';

export type LogLevel = 'off' | 'error' | 'warn' | 'info' | 'debug';

const LEVEL_RANK: Record<LogLevel, number> = {
    off: 0,
    error: 1,
    warn: 2,
    info: 3,
    debug: 4,
};

export class Logger {
    private readonly channel: vscode.OutputChannel;
    private level: LogLevel = 'info';

    constructor(name: string) {
        this.channel = vscode.window.createOutputChannel(name);
    }

    setLevel(level: LogLevel): void {
        this.level = level;
    }

    error(message: string, ...args: unknown[]): void {
        this.write('error', message, args);
    }

    warn(message: string, ...args: unknown[]): void {
        this.write('warn', message, args);
    }

    info(message: string, ...args: unknown[]): void {
        this.write('info', message, args);
    }

    debug(message: string, ...args: unknown[]): void {
        this.write('debug', message, args);
    }

    show(): void {
        this.channel.show(true);
    }

    dispose(): void {
        this.channel.dispose();
    }

    private write(level: Exclude<LogLevel, 'off'>, message: string, args: unknown[]): void {
        if (LEVEL_RANK[level] > LEVEL_RANK[this.level]) {
            return;
        }
        const ts = new Date().toISOString();
        const tag = level.toUpperCase().padEnd(5);
        const formatted = args.length > 0
            ? `${message} ${args.map(formatArg).join(' ')}`
            : message;
        this.channel.appendLine(`[${ts}] ${tag} ${formatted}`);
    }
}

function formatArg(value: unknown): string {
    if (value instanceof Error) {
        return value.stack ?? `${value.name}: ${value.message}`;
    }
    if (value === null || value === undefined) {
        return String(value);
    }
    if (typeof value === 'object') {
        try {
            return JSON.stringify(value);
        } catch {
            return String(value);
        }
    }
    return String(value);
}

let globalLogger: Logger | undefined;

export function getLogger(): Logger {
    if (!globalLogger) {
        globalLogger = new Logger('Helm Values Explorer');
    }
    return globalLogger;
}

export function disposeLogger(): void {
    globalLogger?.dispose();
    globalLogger = undefined;
}
