import type { Migration } from '@mongreldb/kit';
import { migrations as migrations0001 } from './0001_initial';
import { migrations as migrations0002 } from './0002_visited_places';
import { migrations as migrations0003 } from './0003_smtp_security_and_override';
import { migrations as migrations0004 } from './0004_weather';
import { migrations as migrations0005 } from './0005_two_factor';
import { migrations as migrations0006 } from './0006_passkeys';
import { migrations as migrations0007 } from './0007_mcp_oauth';
import { migrations as migrations0008 } from './0008_auto_mark_toggle';

// Central registry of all migrations, in version order. New migrations append
// here; both the runtime singleton (`db/index.ts`) and test fixtures
// (`tests/helpers.ts`) import from this index so they never drift.
export const migrations: Migration[] = [
	...migrations0001,
	...migrations0002,
	...migrations0003,
	...migrations0004,
	...migrations0005,
	...migrations0006,
	...migrations0007,
	...migrations0008
];
