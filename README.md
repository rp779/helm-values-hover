# Helm Values Explorer

[![Version](https://flat.badgen.net/vs-marketplace/v/rossp.helm-values-explorer)](https://marketplace.visualstudio.com/items?itemName=rossp.helm-values-explorer)
[![Installs](https://flat.badgen.net/vs-marketplace/i/rossp.helm-values-explorer)](https://marketplace.visualstudio.com/items?itemName=rossp.helm-values-explorer)
[![Rating](https://flat.badgen.net/vs-marketplace/rating/rossp.helm-values-explorer)](https://marketplace.visualstudio.com/items?itemName=rossp.helm-values-explorer)
[![License: MIT](https://flat.badgen.net/badge/license/MIT/blue)](LICENSE)

A Visual Studio Code extension that enhances your Helm chart development workflow by providing instant value previews and navigation across multiple environment-specific values files.

## Features

- **Smart value preview**: Hover any `{{ .Values.* }}` reference to see its value from every values file in the chart.
- **Subtree hover**: Hovering on an intermediate key like `{{ .Values.image }}` renders the full subtree as YAML — no more "Value Not Found".
- **Full Go-template coverage**: Detects `.Values` references inside `if`, `with`, `range`, function calls (`printf ... .Values.x`), parenthesized expressions (`(eq .Values.env "prod")`), multi-pipe (`.Values.x | default "y" | quote`), and root-context references (`$.Values.x` inside `range`/`with`).
- **Accurate Go-to-Definition**: Uses the YAML AST (via the `yaml` package) to jump to the exact key position in every values file that defines the path.
- **Intelligent autocomplete**: Suggests both leaf keys and parent objects when typing `.Values` paths.
- **Chart-aware discovery**: Locates the chart root via `Chart.yaml` and searches the chart root plus every subchart under `charts/`. Falls back to walking ancestor directories when no `Chart.yaml` is present.
- **Multi-language activation**: Activates on `yaml`, `helm`, `helm-template`, `gotmpl`, and `tpl` documents — works even when your template files are registered to a Helm language extension.
- **Performance**: AST-cached per file, keyed by absolute path, with `RelativePattern`-based file watching to invalidate on change.
- **Diagnostic output channel**: Logging is routed to a dedicated "Helm Values Explorer" output channel with a configurable verbosity (`helmValuesExplorer.logLevel`).

## Installation

1. Open Visual Studio Code
2. Press `Ctrl+P` / `Cmd+P` to open the Quick Open dialog
3. Type `ext install rossp.helm-values-explorer` and press Enter

## Usage

1. Open a Helm chart directory in VS Code
2. Navigate to any template file (e.g., `templates/deployment.yaml`)
3. **Hover** over any `{{ .Values.* }}` expression to see values from all matching files
4. **Ctrl+Click** on any `{{ .Values.* }}` expression to navigate to its definition in the values file(s)
5. **Type** `{{ .Values.` to get autocomplete suggestions for available value paths

### Example

Given these files:
```
mychart/
├── values.yaml         # Default values
├── dev-values.yaml     # Development overrides
├── prod-values.yaml    # Production overrides
└── templates/
    └── deployment.yaml
```

**Hover Preview**: When hovering over `{{ .Values.image.repository }}`, you'll see values from all matching files with clear source labeling.

**Go to Definition**: Ctrl+Click on `{{ .Values.image.repository }}` will jump to the definition of `image.repository` in the values file(s), allowing you to quickly navigate and edit the values.

**Autocomplete**: Type `{{ .Values.image.` and press Ctrl+Space to see available properties like `repository`, `tag`, and `pullPolicy`.

## Configuration

This extension contributes the following settings:

* `helmValuesExplorer.valueFiles`: Glob patterns for values files (default: `["values.yaml", "*values.yaml", "values.*.yaml"]`). Patterns are evaluated against the chart root and every subchart directory under `charts/`.
* `helmValuesExplorer.showFileNames`: Show the source file name above each value in hover output (default: `true`).
* `helmValuesExplorer.logLevel`: Verbosity for the "Helm Values Explorer" output channel. One of `off`, `error`, `warn`, `info`, `debug` (default: `info`).

## Contributing

Contributions are welcome. Here's how you can help:

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Release Notes
### 0.1.0 (2026-05-03)
- **Reliable hover detection**: Rewrote the template parser as a tokenizer that respects strings and comments. Hover, Go-to-Definition, and completion now work inside `if`, `with`, `range`, function arguments, parenthesized expressions, multi-pipe chains, whitespace-trim markers (`{{- ... -}}`), and `$.Values.*` root-context references.
- **Subtree hover**: Hovering on a parent path (e.g. `.Values.image`) now renders the full YAML subtree instead of "Value Not Found".
- **Cleaner hover UI**: Removed emoji clutter. Hover now shows the resolved path in bold, the original expression, and one fenced code block per matching values file.
- **AST-backed Go-to-Definition**: Uses the `yaml` package AST to find the exact line and column of each key in each values file, replacing the previous indentation-based heuristic.
- **Chart-aware discovery**: Finds the chart root via `Chart.yaml` and indexes the chart root plus every subchart under `charts/`. Falls back to ancestor walking when no chart manifest is present.
- **Broader activation**: Now activates on `helm`, `helm-template`, `gotmpl`, and `tpl` documents (in addition to `yaml`), plus workspaces that contain a `Chart.yaml`.
- **Dedicated output channel**: All logging is routed through a "Helm Values Explorer" output channel with a configurable `helmValuesExplorer.logLevel` setting. No more noise in the developer console.
- **Cache correctness**: Cache is now keyed by absolute file path (previously basename), eliminating collisions between identically named values files in different chart directories.
- **Tests**: Added 50 unit and integration tests covering the parser, values index, chart model, and all three providers.

### 0.0.7 (2025-01-XX)
- **Enhanced Pattern Matching**: Support for complex Helm expressions with pipes, functions, and filters (e.g., `{{ .Values.port | default 8080 }}`)
- **Improved Hover Detection**: Hover works anywhere within `{{ }}` expressions, not just on specific words
- **Intelligent Autocomplete**: Context-aware suggestions when typing `.Values` paths
- **Performance Improvements**: Smart caching with file watching for faster response times
- **Better User Experience**: Cleaner hover popup formatting with organized multi-file value display
- **Go to Definition**: Navigate directly to value definitions across multiple files

### 0.0.6 (2025-04-28)
- Lowered minimum VSCode version requirement to 1.74.0 for better compatibility

### 0.0.5 (2025-04-24)
- Synchronized README and CHANGELOG release notes for better documentation consistency

### 0.0.4 (2025-04-24)
- Updated CHANGELOG format and documentation
- Improved README badge clarity using badgen.net

### 0.0.3 (2025-04-24)
- Updated extension icon
- Improved package size by excluding development assets
- Fixed README badges for better visibility on GitHub

### 0.0.2 (2025-04-24)
- Updated extension icon
- Fixed README formatting and badge display

### 0.0.1 (2025-04-24)
- Initial release
- Hover preview for Helm values
- Support for multiple value files (values.yaml, dev-values.yaml, prod-values.yaml)
- Automatic value file detection in current and parent directories
- YAML formatting with source file labels
- Configurable value file patterns
- Toggle for showing/hiding source file names in hover


---

**Made for the Helm community**

Got feedback? [Open an issue](https://github.com/rp779/helm-values-explorer/issues) or star the repo if you find it useful!
