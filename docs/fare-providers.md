<!-- SPDX-FileCopyrightText: 2026 Visorcraft LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-only -->

# Fare providers and watches

Fare providers let Roamarr poll external services for price changes on flight
segments. Configure providers globally, then add per-trip watches.

## Configuring providers

Admin users configure providers under **Settings → Fare providers**:

| Field | Notes |
| --- | --- |
| Provider key | The identifier the watcher expects (e.g. `stub`, `dohop`). |
| Label | Friendly name shown in the UI. |
| API key | Encrypted at rest; required for providers that need credentials. |
| Enabled | Toggle off to pause all watches using this provider. |

Per-user providers can also be created so each traveler uses their own
credentials.

## Adding a fare watch

On a flight segment in a trip, choose **Watch fare** and pick a provider:

- The watch polls the provider on the scheduler tick.
- The last checked time and result are shown on the segment.
- You can pause, resume, delete, or manually recheck a watch.

## Privacy

- Provider API keys are encrypted at rest with AES-256-GCM.
- Fare watch results are visible only to the trip owner and shared editors.

## Related

- [Import/Export](./import-export.md) — backup and restore trips with fare provider references.
- [Reminders](./reminders.md) — scheduler-driven reminders.
- [Segments](./segments.md) — flight segments and other itinerary items.
