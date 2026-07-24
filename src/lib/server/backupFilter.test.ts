import { describe, expect, test } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { findGeonamesTableIds, shouldExcludeFromBackup } from './backupFilter';

describe('backupFilter', () => {
	test('findGeonamesTableIds detects geoname_id schemas', () => {
		const root = join(tmpdir(), `roamarr-backup-filter-${Date.now()}`);
		mkdirSync(join(root, 'tables', '10'), { recursive: true });
		mkdirSync(join(root, 'tables', '5'), { recursive: true });
		writeFileSync(
			join(root, 'tables', '10', 'schema.json'),
			JSON.stringify({
				schema_id: 10,
				columns: [{ id: 1, name: 'geoname_id' }, { id: 2, name: 'name' }]
			})
		);
		writeFileSync(
			join(root, 'tables', '5', 'schema.json'),
			JSON.stringify({
				schema_id: 5,
				columns: [{ id: 1, name: 'id' }, { id: 2, name: 'email' }]
			})
		);

		const ids = findGeonamesTableIds(root);
		expect([...ids]).toEqual(['10']);
		rmSync(root, { recursive: true, force: true });
	});

	test('shouldExcludeFromBackup keeps schema shell and drops runs/indexes', () => {
		const geo = new Set(['10']);
		expect(shouldExcludeFromBackup('roamarr-db/tables/10', geo)).toBe(false);
		expect(shouldExcludeFromBackup('roamarr-db/tables/10/schema.json', geo)).toBe(false);
		expect(shouldExcludeFromBackup('roamarr-db/tables/10/_mf', geo)).toBe(false);
		expect(shouldExcludeFromBackup('roamarr-db/tables/10/_runs/r-1.sr', geo)).toBe(true);
		expect(shouldExcludeFromBackup('roamarr-db/tables/10/_idx/global.idx', geo)).toBe(true);
		expect(shouldExcludeFromBackup('roamarr-db/tables/10/_rcache/x', geo)).toBe(true);
		expect(shouldExcludeFromBackup('roamarr-db/tables/5/_runs/r-1.sr', geo)).toBe(false);
		expect(shouldExcludeFromBackup('roamarr-db/_wal/seg-000000.wal', geo)).toBe(false);
	});
});
