import type { Migration } from '@mongreldb/kit';
import { migrations as migrations0001 } from './0001_initial';
import { migrations as migrations0002 } from './0002_visited_places';

// Central registry of all migrations, in version order. New migrations append
// here; both the runtime singleton (`db/index.ts`) and test fixtures
// (`tests/helpers.ts`) import from this index so they never drift.
export const migrations: Migration[] = [...migrations0001, ...migrations0002];
