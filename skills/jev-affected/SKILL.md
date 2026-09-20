---
name: jev-affected
description: Use jev-affected to inspect committed Git changes, create semantic task plans, explain decisions, and run selected repository checks. Apply when a repository contains jev-affected.yml or the user asks which tests, builds, benchmarks, or code-generation tasks a change affects semantically.
---

# Jev Affected

Use the repository-installed CLI. Prefer `pnpm exec jev-affected` in pnpm
projects and `npx jev-affected` elsewhere.

## Workflow

1. Confirm the current directory is a Git repository and locate
   `jev-affected.yml`. Run `jev-affected init` only when setup is requested and no
   configuration exists.
2. Ensure the relevant edits are committed. Version 0.1 compares commits and does
   not include working-tree changes.
3. On first use, or when privacy matters, run
   `jev-affected inspect --base <ref>`. This previews the sanitized input locally
   without sending a request.
4. Run `jev-affected plan --json --base <ref>` and use its task decisions as the
   record of what should run. Do not invent task reasons or commands.
5. Run `jev-affected run --base <ref>` only when execution is requested. Commands
   come from the repository configuration and should be treated as repository
   code.
6. Report the selected and skipped task counts, actual model version, warnings,
   fallback decisions, and any failed task commands.

Use an explicit base ref in CI and shallow clones. Fetch enough history for Git to
compute the merge base.

## Credentials and data

Set `TYPESAFE_API_KEY` in the process environment or a repository-local `.env`
file. Never print the value, commit `.env`, or store the key in
`jev-affected.yml`. An existing process environment value takes precedence over
`.env`.

`inspect` stays local. `plan`, `why`, and `run` can send the sanitized committed
diff and configured semantic questions to the provider. Review `inspect` output
before the first request when the repository may contain sensitive material.

## Decision invariants

- A valid probability strictly below `skipBelow` produces SKIP.
- Equality with the threshold produces RUN.
- Provider errors, timeouts, and invalid answers produce RUN for candidates.
- `always: true` and `allowSkip: false` protect mandatory tasks.
- Exit code `0` means success, `1` means an executed task or evaluation failed,
  `2` means a usage, configuration, base, or doctor error, and `3` means an
  internal or I/O failure.
