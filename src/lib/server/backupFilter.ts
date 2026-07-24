import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Detect MongrelDB table directory ids that store GeoNames city reference data
 * (geonames_cities). Schema JSON does not carry the logical table name, but the
 * primary key column `geoname_id` uniquely identifies this reference catalog.
 */
export function findGeonamesTableIds(dbPath: string): Set<string> {
	const ids = new Set<string>();
	const tablesDir = join(dbPath, 'tables');
	if (!existsSync(tablesDir)) return ids;

	for (const entry of readdirSync(tablesDir, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;
		const schemaPath = join(tablesDir, entry.name, 'schema.json');
		if (!existsSync(schemaPath)) continue;
		try {
			const schema = JSON.parse(readFileSync(schemaPath, 'utf8')) as {
				columns?: Array<{ name?: string }>;
			};
			const cols = schema.columns ?? [];
			if (cols.some((c) => c.name === 'geoname_id')) {
				ids.add(entry.name);
			}
		} catch {
			// skip unreadable schemas
		}
	}
	return ids;
}

/**
 * tar-fs ignore helper: omit GeoNames city bulk data from downloads while
 * keeping the table shell (schema.json + _mf) so CATALOG still opens cleanly.
 * Re-import cities after restore via Database settings if autocomplete is needed.
 */
export function shouldExcludeFromBackup(relativePath: string, geonamesTableIds: Set<string>): boolean {
	if (geonamesTableIds.size === 0) return false;

	const parts = relativePath.replace(/\\/g, '/').split('/').filter(Boolean);
	const tablesIdx = parts.indexOf('tables');
	if (tablesIdx < 0) return false;

	const tableId = parts[tablesIdx + 1];
	if (!tableId || !geonamesTableIds.has(tableId)) return false;

	// Path is tables/<id> or tables/<id>/...
	const rest = parts.slice(tablesIdx + 2);
	if (rest.length === 0) return false; // keep the directory entry itself

	const top = rest[0];
	// Keep the minimal table shell required for catalog open.
	if (top === 'schema.json' || top === '_mf') return false;
	// Drop bulk run data and secondary indexes for the cities catalog.
	if (top === '_runs' || top === '_idx' || top === '_rcache') return true;

	// Any other payload under the geonames table is reference data — omit.
	return true;
}
