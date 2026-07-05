import type { Migration } from '@visorcraft/mongreldb-kit';
import { eq as kitEq } from '@visorcraft/mongreldb-kit';
import { visitedCountries, visitedUsStates } from '../mongrelSchema';

/**
 * Visited-places consistency fixes:
 * - The `source` enum changed from `['manual','trip','import']` to
 *   `['manual','trip','ai']`. Existing rows tagged `import` are migrated to
 *   `manual`; going forward only `manual`, `trip`, and `ai` are valid.
 * - U.S. state codes changed from bare 2-letter codes (e.g. `CA`) to ISO
 *   3166-2:US format (`US-CA`). Existing bare codes are prefixed with `US-`;
 *   where a `US-` row already exists for the same user, the duplicate bare
 *   row is removed.
 */
const visitedPlacesSourceMigration: Migration = {
	version: 12,
	name: 'visited_places_source',
	up: (ctx) => {
		ctx.kit
			.updateTable(visitedCountries)
			.set({ source: 'manual' })
			.where(kitEq(visitedCountries.source, 'import'))
			.executeSync();

		const existing = ctx.kit.selectFrom(visitedUsStates).executeSync();
		const byUser = new Map<number, Map<string, bigint>>();
		for (const row of existing) {
			const userId = Number(row.user_id);
			const code = String(row.state_code);
			const map = byUser.get(userId) ?? new Map<string, bigint>();
			map.set(code, row.id as bigint);
			byUser.set(userId, map);
		}

		for (const [, codes] of byUser) {
			for (const [code, id] of codes) {
				if (code.startsWith('US-')) continue;
				const normalized = `US-${code.toUpperCase()}`;
				if (codes.has(normalized)) {
					// Duplicate: prefer the ISO-3166-2 row, remove the bare one.
					ctx.kit
						.deleteFrom(visitedUsStates)
						.where(kitEq(visitedUsStates.id, id))
						.executeSync();
				} else {
					ctx.kit
						.updateTable(visitedUsStates)
						.set({ state_code: normalized })
						.where(kitEq(visitedUsStates.id, id))
						.executeSync();
				}
			}
		}
	}
};

export const migrations = [visitedPlacesSourceMigration];
