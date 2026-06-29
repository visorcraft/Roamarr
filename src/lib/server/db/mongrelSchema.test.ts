import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { schema } from './mongrelSchema';
import { openKitDatabase } from './mongrel';

describe('mongrelSchema', () => {
	test('has 45 tables', () => {
		expect(schema.tablesList()).toHaveLength(51);
	});

	test.each([
		['scheduler_runs', ['id']],
		['users', ['id']],
		['sessions', ['id']],
		['password_reset_tokens', ['id']],
		['settings', ['id']],
		['geonames_cities', ['geoname_id']],
		['trips', ['id']],
		['trip_comments', ['id']],
		['segments', ['id']],
		['travel_documents', ['id']],
		['loyalty_programs', ['id']],
		['groups', ['id']],
		['group_members', ['group_id', 'user_id']],
		['trip_shares', ['id']],
		['cards', ['id']],
		['card_benefits', ['id']],
		['benefit_templates', ['id']],
		['insurance_policies', ['id']],
		['fare_providers', ['id']],
		['fare_watches', ['id']],
		['reminders', ['id']],
		['notifications', ['id']],
		['audit_logs', ['id']],
		['trip_companions', ['id']],
		['trip_checklists', ['id']],
		['trip_checklist_items', ['id']],
		['trip_expenses', ['id']],
		['segment_attendees', ['id']],
		['emergency_contacts', ['id']],
		['trip_journal_entries', ['id']],
		['trip_document_links', ['id']],
		['packing_templates', ['id']],
		['packing_template_items', ['id']],
		['trip_polls', ['id']],
		['trip_poll_options', ['id']],
		['trip_poll_votes', ['id']],
		['trip_budget_categories', ['id']],
		['trip_expense_attachments', ['id']],
		['trip_templates', ['id']],
		['trip_home_tasks', ['id']],
		['trip_medications', ['id']],
		['trip_entry_requirements', ['id']],
		['trip_important_items', ['id']],
		['visited_countries', ['id']],
		['visited_us_states', ['id']]
	] as const)('table %s has primary key %j', (tableName, expectedPk) => {
		const table = schema.table(tableName);
		expect(table.primaryKey).toEqual(expectedPk);
	});

	describe('getKitDatabase', () => {
		let tmpDir: string;
		let kit: Awaited<ReturnType<typeof openKitDatabase>>;

		beforeEach(async () => {
			tmpDir = mkdtempSync(join(tmpdir(), 'roamarr-kit-'));
			kit = await openKitDatabase(tmpDir);
		});

		afterEach(() => {
			kit.close();
			rmSync(tmpDir, { recursive: true, force: true });
		});

		test('opens a temp directory and applies migrations', () => {
			const names = kit.tableNames();
			expect(names).toContain('settings');
			expect(names).toContain('benefit_templates');
			expect(names).toContain('users');
		});
	});
});
