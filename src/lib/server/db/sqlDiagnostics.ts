import type { KitDatabase } from '@visorcraft/mongreldb-kit';

type DiagnosticDb = Pick<KitDatabase, 'sqlRows'>;

const HEALTH_SQL_DIAGNOSTIC_QUERY = 'SELECT 1 AS ok';

export async function runReadOnlyDiagnosticQuery(
	db: DiagnosticDb
): Promise<{ rowCount: number }> {
	const rows = await db.sqlRows(HEALTH_SQL_DIAGNOSTIC_QUERY);
	return { rowCount: rows.length };
}
