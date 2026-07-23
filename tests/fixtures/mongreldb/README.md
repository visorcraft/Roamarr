# MongrelDB compatibility fixture

Committed sample database used by `src/lib/server/db/mongrelCompat.test.ts` to
catch engine/kit/storage-layout regressions across package upgrades.

## Contents

| File | Purpose |
| --- | --- |
| `sample-db.tar.gz` | Encrypted MongrelDB data directory (`db/…`) with a few golden rows |
| `manifest.json` | Generation metadata, passphrase, and expected row values |
| `README.md` | This file |

## What the test proves

On every Vitest run, the suite:

1. Extracts `sample-db.tar.gz` to a temp directory
2. Opens it with the **currently installed** `@visorcraft/mongreldb` + kit
3. Applies pending **app** migrations (`mongrelMigrations/`)
4. Reads known settings / user / trip / segment rows
5. Inserts and deletes a probe trip (write path)
6. Runs the native `doctor()` integrity check

If a MongrelDB or Kit upgrade cannot open or migrate this on-disk layout, CI fails.

## Encryption

The fixture is encrypted with the fixed test secret from `vitest.setup.ts`
(`ROAMARR_SECRET`). It is test-only data, not production material.

## When to regenerate

Run:

```sh
npm run db:compat-fixture
```

Regenerate **after**:

- Intentional MongrelDB storage-format / encryption changes that make older
  on-disk directories unreadable (and you are dropping support for them)
- You want the golden rows or fixture metadata updated for a new baseline

Do **not** regenerate merely because Roamarr app migrations advanced. Leaving an
older migration watermark in the fixture is valuable: the test applies current
migrations on open and that path must keep working.

Commit `sample-db.tar.gz` and `manifest.json` together after regeneration.
