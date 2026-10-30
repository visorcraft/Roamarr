import type { Migration } from '@visorcraft/mongreldb-kit';
import { travelDocuments } from '../mongrelSchema';

export const nationalIdMigration: Migration = {
	version: 16,
	name: 'national_id',
	ops: [{ kind: 'alterColumn', table: 'travel_documents', column: 'type' }],
	up: (ctx) => {
		const db = ctx.db;
		const name = travelDocuments.name;
		const staging = '__roamarr_documents_v16';
		const backup = '__roamarr_documents_v16_old';
		// Recover an interrupted rename before inspecting or copying the source.
		if (!db.tableNames().includes(name) && db.tableNames().includes(backup)) {
			db.renameTable(backup, name);
		}
		const type = db.tableColumnSpecs(name).find((c) => c.name === 'type')!;
		if (!type.enumVariants?.includes('national_id')) {
			// The engine cannot widen a populated enum. Keep the original until its copy is committed.
			if (db.tableNames().includes(staging)) db.dropTable(staging);
			ctx.ensureTable({ ...travelDocuments, name: staging });
			const source = db.table(name);
			const rows = source.query([]);
			if (BigInt(rows.length) !== source.count()) throw new Error('Travel document migration read is incomplete');
			const target = db.table(staging);
			target.putBatch(rows.map((row) => row.cells));
			target.commit();
			if (target.count() !== source.count()) throw new Error('Travel document migration copy is incomplete');
			db.renameTable(name, backup);
			try {
				db.renameTable(staging, name);
			} catch (error) {
				db.renameTable(backup, name);
				throw error;
			}
		}
		if (db.tableNames().includes(backup)) db.dropTable(backup);
		ctx.alterColumn(name, 'type', travelDocuments.columns.find((c) => c.name === 'type')!);
	}
};
