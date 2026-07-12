import type { Migration } from '@visorcraft/mongreldb-kit';
import { migrations as initial } from './0001_initial';
import { tripInvitationsMigration } from './0002_trip_invitations';

export const migrations: Migration[] = [...initial, tripInvitationsMigration];
