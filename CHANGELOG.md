# Changelog

## 0.3.0

- Add a repository-owned `jev-affected.yml` for dogfooding this project.
- Analyze committed, working-tree, or staged changes with explicit input modes.
- Detect pull-request base branches across GitHub Actions, GitLab CI, Buildkite,
  and mapped CircleCI pipeline values.
- Inspect and safely clear the Git-local semantic decision cache.
- Avoid treating source text that mentions Git submodule markers as an actual
  submodule diff.

## 0.2.0

- Read API credentials from the process environment only.
- Reject literal API keys in YAML configuration.
- Accept `TYPESAFEAI_API_KEY` as a compatibility fallback.

## 0.1.0

- YAML semantic task conditions, deterministic globs and protected tasks.
- Jev Noul analysis, inspectable plans, JSON output and safe fallback.
- CLI initialization, execution, diagnostics and fixture evaluation.
- Pinned-model cache, privacy exclusions, offline tests and CI matrix.
