# Evaluation

`jev-affected` is designed around one primary safety risk: skipping a task that a
change actually requires. The evaluation suite therefore treats every false skip
as a gate failure.

## Method

Seven curated Git-diff fixtures cover session lifetime changes, public API fields,
comments, logging, database schema, performance-sensitive code, and documentation.
Each fixture declares the tasks that must run. The evaluator asks Jev the same
questions used by the planner, applies the configured `skipBelow` threshold, and
compares the resulting plan with those expectations.

The live evaluation passes only when all of these conditions hold:

- false skips: `0`
- invalid or missing model answers: `0`
- fixture cases with at least one skipped task: `>= 2`
- overall task reduction: `>= 25%`

Provider errors remain fail-safe in ordinary planning: affected candidate tasks
run. A live evaluation instead fails on invalid answers so it can expose provider
or integration problems.

## Latest live result

Run on 2026-09-21 with `jev-1.13.0` and `skipBelow: 0.10`:

| Metric | Result |
| --- | ---: |
| Cases | 7 |
| Task decisions | 28 |
| False skips | 0 |
| Invalid cases | 0 |
| Cases with reduction | 6 |
| Task reduction | 46.43% |
| Unnecessary-run rate | 45.83% |
| API calls | 7 |
| Total latency | 2,139 ms |
| Input tokens | 2,882 |
| Output tokens | 476 |

Selected tasks by fixture:

| Fixture | Selected |
| --- | ---: |
| API field | 3 / 4 |
| Authentication | 4 / 4 |
| Comment | 1 / 4 |
| Database schema | 3 / 4 |
| Documentation | 0 / 4 |
| Logging | 1 / 4 |
| Performance | 3 / 4 |

## Reproduce

Build first, then run either evaluation:

```sh
pnpm build
pnpm eval
pnpm eval:live
```

`pnpm eval` uses deterministic synthetic answers and verifies evaluation and
decision plumbing without making a network request. `pnpm eval:live` reads
`TYPESAFE_API_KEY` from the process environment or a local `.env` file and sends
the fixture inputs to Jev.

## Limits

The fixtures are small, curated, and specific to this task taxonomy. The latest
result is evidence for this release and threshold; it is not a general accuracy
claim. Live model results can vary between versions and runs. Repositories should
protect mandatory checks with `always: true` or `allowSkip: false`, keep conditions
specific, and maintain their own representative evaluation cases.
