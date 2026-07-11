import type { Migration } from '@visorcraft/mongreldb-kit';
import { migrations as initial } from './0001_initial';

// Pre-release baseline: current schema only. Add incremental migrations after
// the first public release has databases that must be upgraded in place.
export const migrations: Migration[] = [...initial];
