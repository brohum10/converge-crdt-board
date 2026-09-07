# Contributing to Converge

Contributions are welcome when they preserve convergence, offline usability, and bounded server behavior.

## Local checks

```bash
npm ci
npm run typecheck
npm test
npm run build
```

Use `docker compose up --build` to exercise PostgreSQL persistence and the production-style sync service.

## Expectations

- Define the convergence or ordering invariant affected by a CRDT change.
- Add deterministic replica tests and property-based coverage for conflict-resolution changes.
- Keep local mutations responsive and replayable after reconnecting.
- Preserve payload, rate, socket-backpressure, and persistence bounds.
- Update the architecture or benchmark document when changing synchronization or storage behavior.

Pull requests should include the user-visible behavior, invariant reasoning, tests performed, and migration or compatibility impact.
