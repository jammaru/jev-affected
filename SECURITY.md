# Security

## Supported versions

The current 0.1.x line receives security fixes.

## Reporting a vulnerability

Do not post secrets or exploit details in a public issue. Once the public repository is configured, use its GitHub private vulnerability reporting feature. Until then, contact the repository owner privately using an established channel. Enabling private reporting is a release gate.

## Secret handling

Set TYPESAFE_API_KEY through your environment or CI secret store. The application disables SDK logging and does not emit provider error bodies. Exclusion globs are additive; they cannot detect every embedded secret. Inspect your inputs before enabling remote analysis.

## External API calls

Diffs, changed paths, commit identifiers and questions are sent to the TypeSafe SDK endpoint. `inspect` is local. `doctor` contacts the models endpoint without uploading repository data. `eval --live` uploads fixture states. No telemetry is collected.

## Execution trust

Commands use a shell. Treat configuration as executable code. Do not run commands from untrusted checkouts with credentials or elevated privileges. The model never supplies commands. Local cache contents are trusted like the checkout itself.
