<!-- SPDX-FileCopyrightText: 2026 Visorcraft LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-only -->

# Fare providers and watches

Fare watches are implemented, but the current release ships no live commercial
fare integration. The only registered provider is **Stub (demo)**, whose result
states that no live data was checked.

Do not rely on it for purchasing decisions or price alerts.

## Provider account

Administrators open **Fare providers** to create, edit, test, enable, or delete
an account. Fields are:

- registered provider key;
- display label;
- optional API key;
- enabled flag.

API keys are encrypted. Provider rows are user-owned internally. The current
web/API creation route requires an administrator, so a provider can watch only
trips owned by that same administrator account.

## Watch

The scoped fare-watch JSON API can:

- list owned watches and eligible provider accounts;
- create a trip-level or segment-level watch;
- pause/resume;
- run a manual check;
- delete.

A watch is owner-only. Its provider must belong to the same user, and an
optional segment must belong to the selected trip. Creating the same
trip/provider/segment watch again returns the existing row.

The current trip page counts fare watches in the Budget tab but does not expose
the complete watch controls. Use the OAuth-protected `/api/fare-watches`
surface until a dedicated web control is present.

## Scheduler

Every scheduler tick selects up to 50 active watches, oldest checked first.
Each provider call has a 10-second timeout.

The first result establishes a baseline. Later checks send a generic
notification only when the summary string changes. Notifications do not expose
the fare result body.

## Add a real provider

A code contribution must implement the `FareProvider` interface and register
it under `src/lib/server/fareproviders/`, including focused lifecycle and
timeout tests. Do not enter a provider key that is not in the running
registry.

See [Contributing](../CONTRIBUTING.md).
