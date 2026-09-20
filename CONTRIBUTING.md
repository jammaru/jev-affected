# Contributing

Use Node.js 20+ and pnpm 10.11.0.

```sh
pnpm install
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm smoke
```

Include tests for routing, privacy and execution behavior. Prefer offline fixtures; identify synthetic responses explicitly and never present them as live model measurements. Live evaluation is optional locally and mandatory before release. Never submit credentials or private code.

Use `pnpm exec changeset` for user-visible changes. Keep changes within the v0.1 CLI scope. Follow CODE_OF_CONDUCT.md.
