<!-- SPDX-FileCopyrightText: 2026 VisorCraft LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-only -->

# Contributing to Roamarr

Thank you for helping improve Roamarr. This project is a self-hosted SvelteKit
and MongrelDB Kit travel organizer. Changes should be small, tested, and aligned
with the existing route, server-helper, and UI patterns.

## Contribution Workflow

1. Fork the repository on GitHub.
2. Clone your fork:

   ```sh
   git clone https://github.com/<you>/roamarr.git
   cd roamarr
   ```

3. Create a focused branch:

   ```sh
   git checkout -b fix-trip-reminder
   ```

4. Install dependencies:

   ```sh
   npm ci
   ```

5. Make the smallest change that fully solves the issue.
6. Add or update tests and documentation.
7. Run the local checks that match the change:

   ```sh
   npm run check
   npm test
   ```

8. Push your branch and open a pull request against `master`.

Pull requests should include a clear summary, the tests you ran, and screenshots
when the change affects the UI.

## Project Layout

- `src/routes/` contains SvelteKit pages, layouts, and route actions. Keep route
  files thin and delegate business logic to `src/lib/server/`.
- `src/lib/server/` contains auth, settings, scheduler, sharing, ownership,
  travel-domain logic, import/export, notifications, expenses, and admin
  operations.
- `src/lib/server/db/` contains MongrelDB Kit schema, connection setup, and
  repository helpers.
- `src/lib/components/`, `src/lib/icons.ts`, and `src/app.css` contain shared UI
  components, icon names, Tailwind v4 tokens, and reusable app classes.
- `tests/helpers.ts` and `tests/eventHelpers.ts` contain shared database and
  SvelteKit event fixtures.

Prefer existing helpers, shared fixtures, and app classes over new one-off
patterns.

## Local Development

Roamarr requires Node.js 24 or newer.

```sh
npm ci
export ROAMARR_SECRET="$(openssl rand -base64 32)"
export DATABASE_PATH="./roamarr-db"
npm run dev
```

Open `http://localhost:5173/setup` on first boot.

Useful commands:

```sh
npm run dev              # Vite dev server
npm run check            # Svelte + TypeScript check
npm test                 # Vitest suite once
npm run build            # production build to ./build
npm run credits:generate # regenerate bundled license and credits data
```

Do not commit real `.env` files, local databases, logs, generated build output,
Playwright output, screenshots, dependencies, or machine-local state.

## Coding Standards

- Use TypeScript ES modules and the existing Svelte 5 patterns.
- Prefer `$lib/server/*` aliases over deep relative imports.
- Keep route actions thin: validate input, enforce ownership or authorization,
  call server modules, and return SvelteKit `fail`, `redirect`, or `error`
  responses.
- Prefer repository helpers and kit query builders over raw SQL.
- Use explicit transactions for atomic multi-step mutations.
- Use Luxon for timezone and datetime math.
- Reuse validators from `src/lib/server/validation.ts`, action helpers from
  `src/lib/server/actions.ts`, and parameter parsers from
  `src/lib/server/params.ts`.
- Use shared UI components and classes before adding one-off Svelte markup or
  CSS.
- Add concise comments only when the reason is not obvious from the code.
- Avoid unrelated formatting, broad refactors, and speculative abstractions.

## Security And Privacy

Roamarr stores sensitive travel data. Do not weaken security invariants without
an explicit design decision.

- Passwords must use argon2id.
- Session cookies must contain only random tokens; the database stores only
  token hashes.
- Encrypted-at-rest fields must remain encrypted.
- Public shares and calendar feeds must expose only the reduced viewer
  projection.
- Reads must use sharing checks, and mutations with client-supplied foreign IDs
  must enforce ownership.
- Security-relevant mutations must write audit log entries.
- Notifications, emails, webhooks, and public projections must not leak private
  document numbers, policy numbers, confirmation numbers, card details, or
  notes.

Follow the disclosure policy in [docs/SECURITY.md](docs/SECURITY.md). Do not
report vulnerabilities through public issues or pull requests.

## Tests

Match test coverage to the risk of the change:

- Server logic should have focused Vitest coverage near the source file.
- Route actions should test validation, authorization, and mutation behavior.
- Schema changes should update `mongrelSchema.ts` and include tests for affected
  behavior.
- Security-sensitive changes should cover negative authorization and validation
  paths.
- UI changes should at least pass `npm run check`; add browser or component
  coverage when behavior is non-trivial.

Run the broader gate before opening substantial pull requests:

```sh
npm run check
npm test
```

## Documentation

Update documentation in the same pull request when behavior, setup, deployment,
environment variables, or user-facing workflows change.

- Setup and usage belong in [README.md](README.md).
- Security disclosure and threat model details belong in
  [docs/SECURITY.md](docs/SECURITY.md).
- Dependency changes should run `npm run credits:generate` so the Settings/About
  license and credits pages stay current.

## Dependency Policy

Roamarr is GPL-3.0-only. New dependencies must be compatible with the project
license and should be added only when they clearly reduce complexity or provide
well-tested domain behavior that should not be maintained locally.

When changing dependencies:

1. Update `package.json` and `package-lock.json`.
2. Run `npm run credits:generate`.
3. Verify the Settings/About license and credits pages still render.

## Pull Request Expectations

A good pull request:

- Has one clear purpose.
- Describes user-visible behavior changes.
- Calls out migrations, deployment changes, or compatibility risks.
- Includes tests, or explains why tests are not practical.
- Updates docs when behavior changes.
- Passes the relevant local checks.
- Avoids unrelated formatting or refactoring churn.
