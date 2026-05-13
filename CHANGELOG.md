# Change Log

All notable changes to the "Helm Values Explorer" extension will be documented in this file.

## [0.1.0] - 2026-05-03
### Added
- Dedicated `Helm Values Explorer` output channel and `helmValuesExplorer.logLevel` setting (`off`/`error`/`warn`/`info`/`debug`).
- Activation for `helm`, `helm-template`, `gotmpl`, and `tpl` languages and for workspaces containing `Chart.yaml`.
- Chart-aware values-file discovery: searches the chart root (located via `Chart.yaml`) and every subchart under `charts/`.
- Subtree hover: hovering on a parent path renders the entire YAML subtree.
- Detection of `.Values` references inside `if` / `with` / `range`, function arguments, parenthesized expressions, multi-pipe chains, whitespace-trim markers, and `$.Values.*` root-context references.
- Unit and integration tests for parser, values index, chart model, hover, definition, and completion providers.

### Changed
- Rewrote the extension around modular files under `src/helm`, `src/providers`, and `src/util`.
- Replaced regex-based template scanning with a tokenizer that respects string literals and Go-template comments.
- Switched the YAML parser from `js-yaml` to the `yaml` package to get AST positions and accurate Go-to-Definition.
- Hover UI: removed emoji decoration; now displays the resolved path in bold, the original expression, and one fenced code block per matching values file.
- Cache is keyed by absolute file path (was basename) and uses `RelativePattern`-based file watchers.

### Removed
- The hand-rolled `findYamlKeyLocation` indentation walker.
- `console.log` usage throughout the codebase.

## [0.0.7] - 2025-01-XX
### Added
- **Go to Definition Support**: Ctrl+Click on any `{{ .Values.* }}` expression to jump directly to its definition in the relevant values file(s)
- Navigate between values definitions across multiple environment files
- Precise cursor positioning at the exact YAML key location

## [0.0.6] - 2025-04-28
### Changed
- Lowered minimum VSCode version requirement to 1.74.0 to improve compatibility with more VSCode installations

## [0.0.5] - 2025-04-24
### Changed
- Synchronized README and CHANGELOG release notes for better documentation consistency

## [0.0.4] - 2025-04-24
### Changed
- Updated CHANGELOG format and documentation
- Improved README badge clarity using badgen.net

## [0.0.3] - 2025-04-24
### Changed
- Updated extension icon
- Improved package size by excluding development assets
- Fixed README badges for better visibility on GitHub

## [0.0.2] - 2025-04-24
### Changed
- Updated extension icon
- Fixed README formatting and badge display

## [0.0.1] - 2025-04-24
### Added
- Initial release
- Hover preview for Helm values
- Support for multiple value files (values.yaml, dev-values.yaml, prod-values.yaml)
- Automatic value file detection in current and parent directories
- YAML formatting with source file labels
- Configurable value file patterns
- Toggle for showing/hiding source file names in hover