import type { Migration } from '@visorcraft/mongreldb-kit';
import { migrations as migrations0001 } from './0001_initial';
import { migrations as migrations0002 } from './0002_visited_places';
import { migrations as migrations0003 } from './0003_smtp_security_and_override';
import { migrations as migrations0004 } from './0004_weather';
import { migrations as migrations0005 } from './0005_two_factor';
import { migrations as migrations0006 } from './0006_passkeys';
import { migrations as migrations0007 } from './0007_mcp_oauth';
import { migrations as migrations0008 } from './0008_auto_mark_toggle';
import { migrations as migrations0009 } from './0009_oauth_constraints';
import { migrations as migrations0010 } from './0010_weather_payload_json_type';
import { migrations as migrations0011 } from './0011_oauth_client_allow_list';
import { migrations as migrations0012 } from './0012_visited_places_source';
import { migrations as migrations0013 } from './0013_attachments_table';
import { migrations as migrations0014 } from './0014_visited_place_date_range';
import { migrations as migrations0015 } from './0015_session_cookie_same_site';
import { migrations as migrations0016 } from './0016_loyalty_balance_updated_at';
import { migrations as migrations0017 } from './0017_reminders_user_fields';
import { migrations as migrations0018 } from './0018_settings_date_formats';
import { migrations as migrations0019 } from './0019_settings_backfill_defaults';
import { migrations as migrations0020 } from './0020_nullable_settings_leads';
import { migrations as migrations0021 } from './0021_settings_catchup_repair';
import { migrations as migrations0022 } from './0022_scheduler_run_summary';
import { migrations as migrations0023 } from './0023_trip_poster_attachment';

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
	...migrations0008,
	...migrations0009,
	...migrations0010,
	...migrations0011,
	...migrations0012,
	...migrations0013,
	...migrations0014,
	...migrations0015,
	...migrations0016,
	...migrations0017,
	...migrations0018,
	...migrations0019,
	...migrations0020,
	...migrations0021,
	...migrations0022,
	...migrations0023
];
