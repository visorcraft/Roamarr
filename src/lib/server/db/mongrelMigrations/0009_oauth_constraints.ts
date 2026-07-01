import type { Migration, MigrationContext, TableSpec, UniqueSpec, ForeignKeySpec } from '@visorcraft/mongreldb-kit';
import { eq as kitEq } from '@visorcraft/mongreldb-kit';
import {
	kitUniqueKeys,
	kitRowGuards,
	KIT_KEY_VERSION,
	encodedPk,
	encodeUniqueKey,
	encodeRowGuardKey,
	parentExists
} from '@visorcraft/mongreldb-kit';
import { oauthClients, oauthTokens, users } from '../mongrelSchema';

function isoNow(): string {
	return new Date().toISOString();
}

/**
 * Synchronous backfill of a unique constraint for use inside Roamarr's sync
 * migration path. Mirrors the async `addUnique` helper in `@visorcraft/mongreldb-kit` but
 * uses only synchronous Kit query builders so it can run under `migrateSync`.
 */
function addUniqueSync(
	kit: MigrationContext['kit'],
	table: TableSpec,
	uniqueSpec: UniqueSpec
): void {
	if (table.unique.some((u) => u.name === uniqueSpec.name)) return;

	const existingKeys = new Set<string>();
	for (const guard of kit
		.selectFrom(kitUniqueKeys)
		.where(kitEq(kitUniqueKeys.owner_table, table.name))
		.executeSync()) {
		existingKeys.add(guard.encoded_key as string);
	}

	const seen = new Map<string, bigint>();
	const now = isoNow();
	for (const row of kit.selectFrom(table).executeSync()) {
		const values = uniqueSpec.columns.map((colName) =>
			row[colName] === undefined ? null : row[colName]
		) as (string | bigint | null)[];
		if (values.some((v) => v === null || v === undefined)) continue;

		const encodedKey = encodeUniqueKey(KIT_KEY_VERSION, uniqueSpec.name, values);
		const ownerPk = row.id as bigint;
		const prior = seen.get(encodedKey);
		if (prior !== undefined && prior !== ownerPk) {
			throw new Error(
				`Cannot add unique constraint "${uniqueSpec.name}" on "${table.name}": existing rows violate it`
			);
		}
		seen.set(encodedKey, ownerPk);
		if (existingKeys.has(encodedKey)) continue;

		kit
			.insertInto(kitUniqueKeys)
			.values({
				encoded_key: encodedKey,
				constraint_name: uniqueSpec.name,
				owner_table: table.name,
				owner_pk: encodedPk(ownerPk),
				created_at: now
			})
			.executeSync();
	}

	table.unique.push(uniqueSpec);
}

/**
 * Synchronous backfill of a foreign key for use inside Roamarr's sync
 * migration path. Mirrors the async `addForeignKey` helper in `@visorcraft/mongreldb-kit`
 * but uses only synchronous Kit query builders. Existing child rows that
 * reference missing parents are deleted so the constraint can be satisfied;
 * this matches the intended `onDelete: 'cascade'` semantics retroactively.
 */
function addForeignKeySync(
	kit: MigrationContext['kit'],
	table: TableSpec,
	fk: ForeignKeySpec
): void {
	if (table.foreignKeys.some((f) => f.name === fk.name)) return;

	const parentTable = kit.schema.table(fk.referencesTable);
	const ckit = { db: kit.nativeDb, schema: kit.schema };
	const touched = new Set<string>();
	const now = isoNow();
	const orphanClientIds: string[] = [];

	for (const row of kit.selectFrom(table).executeSync()) {
		const fkValues = fk.columns.map((colName) => row[colName]);
		if (fkValues.some((v) => v === null || v === undefined)) continue;

		const parentPk = fkValues[0] as bigint;
		if (!parentExists(ckit, parentTable.name, parentPk)) {
			orphanClientIds.push(row.client_id as string);
			continue;
		}

		const guardKey = encodeRowGuardKey(parentTable.name, parentPk);
		if (touched.has(guardKey)) continue;
		touched.add(guardKey);

		const existing = kit
			.selectFrom(kitRowGuards)
			.where(kitEq(kitRowGuards.encoded_guard_key, guardKey))
			.executeSync()[0];
		if (existing) {
			kit
				.updateTable(kitRowGuards)
				.set({
					version: (existing.version as bigint) + 1n,
					updated_at: now
				})
				.where(kitEq(kitRowGuards.encoded_guard_key, guardKey))
				.executeSync();
		} else {
			kit
				.insertInto(kitRowGuards)
				.values({
					encoded_guard_key: guardKey,
					table_name: parentTable.name,
					primary_key: encodedPk(parentPk),
					version: 1n,
					updated_at: now
				})
				.executeSync();
		}
	}

	// Retroactively apply cascade semantics: any client whose creator no longer
	// exists would violate the new FK, so remove it before enabling enforcement.
	for (const clientId of orphanClientIds) {
		kit.deleteFrom(oauthClients).where(kitEq(oauthClients.client_id, clientId)).executeSync();
	}

	table.foreignKeys.push(fk);
}

const oauthConstraintsMigration: Migration = {
	version: 9,
	name: 'oauth_constraints',
	ops: [
		{
			kind: 'addForeignKey',
			table: 'oauth_clients',
			constraint: 'fk_oauth_clients_created_by_user_id_users'
		},
		{ kind: 'addUnique', table: 'oauth_tokens', constraint: 'oauth_tokens_refresh_hash_uq' }
	],
	up: (ctx) => {
		addUniqueSync(ctx.kit, ctx.kit.schema.table('oauth_tokens'), {
			name: 'oauth_tokens_refresh_hash_uq',
			columns: ['refresh_token_hash']
		});
		addForeignKeySync(ctx.kit, ctx.kit.schema.table('oauth_clients'), {
			name: 'fk_oauth_clients_created_by_user_id_users',
			columns: ['created_by_user_id'],
			referencesTable: 'users',
			referencesColumns: ['id'],
			onDelete: 'cascade'
		});
	}
};

export const migrations = [oauthConstraintsMigration];
