import type { Migration } from '@mongreldb/kit';
import { schema, settings, benefitTemplates } from '../mongrelSchema';

const DEFAULT_BENEFIT_TEMPLATES = [
	{
		benefit_type: 'trip_delay',
		name: 'Trip delay reimbursement',
		coverage_amount: 50000n,
		description: 'Reimburses meals, lodging and transport when a trip is delayed.'
	},
	{
		benefit_type: 'baggage_delay',
		name: 'Baggage delay reimbursement',
		coverage_amount: 10000n,
		description: 'Reimburses essential purchases when checked baggage is delayed.'
	},
	{
		benefit_type: 'trip_cancellation',
		name: 'Trip cancellation reimbursement',
		coverage_amount: 100000n,
		description: 'Reimburses non-refundable trip costs if you cancel for a covered reason.'
	}
];

const initialMigration: Migration = {
	version: 1,
	name: 'initial',
	up: async (ctx) => {
		for (const table of schema.tablesList()) {
			await ctx.ensureTable(table);
		}

		await ctx.kit
			.insertInto(settings)
			.values({
				id: 1n,
				smtp_host: null,
				smtp_port: null,
				smtp_user: null,
				smtp_pass: null,
				smtp_from: null,
				webhook_url: null,
				maps_geonames_imported_at: null,
				maps_tile_url: null,
				maps_tile_attribution: null,
				maps_tile_api_key: null
			})
			.execute();

		const count = await ctx.kit.selectFrom(benefitTemplates).selectCount().execute();
		if (count === 0n) {
			for (const template of DEFAULT_BENEFIT_TEMPLATES) {
				await ctx.kit.insertInto(benefitTemplates).values(template).execute();
			}
		}
	}
};

export const migrations = [initialMigration];
