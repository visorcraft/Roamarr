import { describe, test, expect, beforeEach, vi } from 'vitest';
import { DateTime } from 'luxon';
import type { KitDatabase } from '@visorcraft/mongreldb-kit';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

const ctx = vi.hoisted(() => ({ kit: null as unknown as KitDatabase }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { createMcpServer } from './mcpServer';
import { createApiKey, verifyApiKey } from './apiKeys';
import type { Scope } from './oauth';
import * as tripsRepo from './repositories/tripsRepo';
import * as tripsShared from '../../routes/trips/shared';
import * as travelDataRepo from './repositories/travelDataRepo';
import { addItem as addChecklistItem } from './tripChecklists';
import { trips, visitedCountries, visitedUsStates, tripChecklistItems, users, places, placeCategories, placeLinks, reminders, auditLogs, SEGMENT_PAYMENT_STATUSES } from './db/mongrelSchema';
import { eq as kitEq } from '@visorcraft/mongreldb-kit';
import { makeUser, makeTrip, makeSegment, makeShare, makeTravelDocument } from '../../../tests/helpers';
import { upsertCustomReminder } from './reminders';
import { COMPANION_PRIVATE_FIELDS } from './sharing';
import { getReminderBySource, getReminderById, createReminder } from './repositories/remindersRepo';
import * as segmentsRepo from './repositories/segmentsRepo';
import { getSettings, updateSettings } from './settings';

async function connect(userId: number, scopes: Scope[]) {
	const server = createMcpServer(userId, scopes);
	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
	await server.connect(serverTransport);
	const client = new Client({ name: 'test', version: '1.0.0' }, { capabilities: {} });
	await client.connect(clientTransport);
	return { client, server };
}

async function readPrompt(
	client: Client,
	name: string,
	arguments_: Record<string, string> = {}
) {
	const res = await client.getPrompt({ name, arguments: arguments_ });
	return res;
}

function promptText(res: Awaited<ReturnType<Client['getPrompt']>>): string {
	const content = res.messages[0]?.content;
	if (content && content.type === 'text') return content.text;
	return '';
}

function resourceText(res: Awaited<ReturnType<Client['readResource']>>): string {
	const item = res.contents[0];
	if (item && 'text' in item) return item.text;
	return '';
}

describe('mcpServer', () => {
	let userId: number;

	beforeEach(() => {
		ctx.kit.deleteFrom(tripChecklistItems).executeSync();
		ctx.kit.deleteFrom(trips).executeSync();
		ctx.kit.deleteFrom(visitedCountries).executeSync();
		ctx.kit.deleteFrom(visitedUsStates).executeSync();
		updateSettings({ allowMcpPii: false });
		userId = makeUser(ctx.kit).id;
	});

	test('lists the documented tools', async () => {
		const { client } = await connect(userId, ['trips:read']);
		const { tools } = await client.listTools();
		const names = tools.map((t) => t.name);
		expect(names).toContain('roamarr_trip_create');
		expect(names).toContain('roamarr_places_mark');
	});

	test('a write tool requires its scope', async () => {
		const { client } = await connect(userId, ['trips:read']);
		const res: any = await client.callTool({ name: 'roamarr_trip_create', arguments: { name: 'Nope' } });
		expect(res.isError).toBe(true);
		expect(res.content[0].text).toContain('trips:write');
	});

	test('an MCP session authorized via a personal API key honors the key scopes', async () => {
		const { token } = createApiKey(userId, { name: 'agent', scopes: ['trips:read'] });
		const verified = verifyApiKey(token);
		expect(verified).toBeTruthy();
		// The MCP server consumes exactly the (userId, scopes) pair the key supplies.
		const { client } = await connect(verified!.userId, verified!.scopes);

		const allowed: any = await client.callTool({ name: 'roamarr_trip_list', arguments: {} });
		expect(allowed.isError).toBeFalsy();

		const denied: any = await client.callTool({ name: 'roamarr_trip_create', arguments: { name: 'Nope' } });
		expect(denied.isError).toBe(true);
		expect(denied.content[0].text).toContain('trips:write');
	});

	test('profile exposes role for native capability gating', async () => {
		const { client } = await connect(userId, ['profile-prefs:read']);
		const result: any = await client.callTool({ name: 'roamarr_profile_get', arguments: {} });
		expect(JSON.parse(result.content[0].text).role).toBe('user');
	});

	test('companion tools accept guide and driver roles', async () => {
		const trip = tripsRepo.createTrip(userId, { name: 'Role trip' });
		const { client } = await connect(userId, ['companions:write', 'companions:read']);
		const created: any = await client.callTool({ name: 'roamarr_companion_create', arguments: { tripId: trip.id, name: 'Pat', category: 'guide' } });
		const companionId = JSON.parse(created.content[0].text).id;
		await client.callTool({ name: 'roamarr_companion_update', arguments: { companionId, category: 'driver' } });
		const listed: any = await client.callTool({ name: 'roamarr_companion_list', arguments: { tripId: trip.id } });
		expect(JSON.parse(listed.content[0].text).items[0].category).toBe('driver');
	});

	test('companion update rejects an unknown category', async () => {
		const trip = tripsRepo.createTrip(userId, { name: 'Validation trip' });
		const { insertTripCompanion } = await import('./tripCompanions');
		const companion = insertTripCompanion(userId, trip.id, { name: 'Pat', category: 'adult' });
		const { client } = await connect(userId, ['companions:read', 'companions:write']);
		const res: any = await client.callTool({ name: 'roamarr_companion_update', arguments: { companionId: companion.id, category: 'robot' } });
		expect(res.isError).toBe(true);
		expect(res.content[0].text).toContain('category');
		const listed: any = await client.callTool({ name: 'roamarr_companion_list', arguments: { tripId: trip.id } });
		expect(JSON.parse(listed.content[0].text).items[0].category).toBe('adult');
	});

	test('companion update rejects a non-boolean flag', async () => {
		const trip = tripsRepo.createTrip(userId, { name: 'Validation trip' });
		const { insertTripCompanion } = await import('./tripCompanions');
		const companion = insertTripCompanion(userId, trip.id, { name: 'Pat', needsCarSeat: true });
		const { client } = await connect(userId, ['companions:read', 'companions:write']);
		const res: any = await client.callTool({ name: 'roamarr_companion_update', arguments: { companionId: companion.id, needsCarSeat: 'false' } });
		expect(res.isError).toBe(true);
		const listed: any = await client.callTool({ name: 'roamarr_companion_list', arguments: { tripId: trip.id } });
		expect(JSON.parse(listed.content[0].text).items[0].needsCarSeat).toBe(true);
	});

	test('companion update rejects an empty or non-string name', async () => {
		const trip = tripsRepo.createTrip(userId, { name: 'Validation trip' });
		const { insertTripCompanion } = await import('./tripCompanions');
		const companion = insertTripCompanion(userId, trip.id, { name: 'Pat' });
		const { client } = await connect(userId, ['companions:read', 'companions:write']);
		const emptyRes: any = await client.callTool({ name: 'roamarr_companion_update', arguments: { companionId: companion.id, name: '' } });
		expect(emptyRes.isError).toBe(true);
		const numRes: any = await client.callTool({ name: 'roamarr_companion_update', arguments: { companionId: companion.id, name: 123 } });
		expect(numRes.isError).toBe(true);
		const listed: any = await client.callTool({ name: 'roamarr_companion_list', arguments: { tripId: trip.id } });
		expect(JSON.parse(listed.content[0].text).items[0].name).toBe('Pat');
	});

	test('companion update with only a category leaves every other field untouched', async () => {
		const trip = tripsRepo.createTrip(userId, { name: 'Validation trip' });
		const { insertTripCompanion } = await import('./tripCompanions');
		const companion = insertTripCompanion(userId, trip.id, { name: 'Pat', category: 'adult', dietary: 'vegan', needsCarSeat: true, notes: 'keep me' });
		const { client } = await connect(userId, ['companions:read', 'companions:write']);
		const res: any = await client.callTool({ name: 'roamarr_companion_update', arguments: { companionId: companion.id, category: 'child' } });
		expect(res.isError).toBeFalsy();
		const listed: any = await client.callTool({ name: 'roamarr_companion_list', arguments: { tripId: trip.id } });
		const row = JSON.parse(listed.content[0].text).items[0];
		expect(row.category).toBe('child');
		expect(row.name).toBe('Pat');
		expect(row.dietary).toBe('vegan');
		expect(row.needsCarSeat).toBe(true);
		expect(row.notes).toBe('keep me');
	});

	test('companion update with an explicit null flag leaves the stored flag unchanged', async () => {
		const trip = tripsRepo.createTrip(userId, { name: 'Validation trip' });
		const { insertTripCompanion } = await import('./tripCompanions');
		const companion = insertTripCompanion(userId, trip.id, { name: 'Pat', needsCarSeat: true });
		const { client } = await connect(userId, ['companions:read', 'companions:write']);
		const res: any = await client.callTool({ name: 'roamarr_companion_update', arguments: { companionId: companion.id, needsCarSeat: null } });
		expect(res.isError).toBeFalsy();
		const listed: any = await client.callTool({ name: 'roamarr_companion_list', arguments: { tripId: trip.id } });
		expect(JSON.parse(listed.content[0].text).items[0].needsCarSeat).toBe(true);
	});

	test('companion create rejects a non-boolean flag and stores exact values', async () => {
		const trip = tripsRepo.createTrip(userId, { name: 'Create trip' });
		const { client } = await connect(userId, ['companions:read', 'companions:write']);
		const bad: any = await client.callTool({ name: 'roamarr_companion_create', arguments: { tripId: trip.id, name: 'Pat', needsCarSeat: 'false' } });
		expect(bad.isError).toBe(true);
		const before: any = await client.callTool({ name: 'roamarr_companion_list', arguments: { tripId: trip.id } });
		expect(JSON.parse(before.content[0].text).items).toHaveLength(0);
		const good: any = await client.callTool({ name: 'roamarr_companion_create', arguments: { tripId: trip.id, name: 'Pat', needsCarSeat: false, needsStroller: true } });
		expect(good.isError).toBeFalsy();
		const listed: any = await client.callTool({ name: 'roamarr_companion_list', arguments: { tripId: trip.id } });
		const rows = JSON.parse(listed.content[0].text).items;
		expect(rows).toHaveLength(1);
		expect(rows[0].needsCarSeat).toBe(false);
		expect(rows[0].needsStroller).toBe(true);
	});

	test('companion create rejects an unknown category and defaults to adult', async () => {
		const trip = tripsRepo.createTrip(userId, { name: 'Default category trip' });
		const { client } = await connect(userId, ['companions:read', 'companions:write']);
		const bad: any = await client.callTool({ name: 'roamarr_companion_create', arguments: { tripId: trip.id, name: 'Pat', category: 'robot' } });
		expect(bad.isError).toBe(true);
		const good: any = await client.callTool({ name: 'roamarr_companion_create', arguments: { tripId: trip.id, name: 'Pat' } });
		expect(good.isError).toBeFalsy();
		const listed: any = await client.callTool({ name: 'roamarr_companion_list', arguments: { tripId: trip.id } });
		const rows = JSON.parse(listed.content[0].text).items;
		expect(rows).toHaveLength(1);
		expect(rows[0].category).toBe('adult');
	});

	test('mobile trip workflows preserve full user-entered fields', async () => {
		const trip = tripsRepo.createTrip(userId, { name: 'Complete mobile trip' });
		const { client } = await connect(userId, [
			'companions:read', 'companions:write', 'journal:read', 'journal:write',
			'home-tasks:read', 'home-tasks:write', 'medications:read', 'medications:write',
			'items:read', 'items:write', 'requirements:read', 'requirements:write',
			'doc-links:read', 'doc-links:write'
		]);
		const call = async (name: string, arguments_: Record<string, unknown>) => {
			const result: any = await client.callTool({ name, arguments: arguments_ });
			expect(result.isError, result.content?.[0]?.text).toBeFalsy();
			return JSON.parse(result.content[0].text);
		};
		const companion = await call('roamarr_companion_create', { tripId: trip.id, name: 'Sam', category: 'child', dietary: 'vegan', allergies: 'nuts', medicalNotes: 'inhaler', needsCarSeat: true, needsStroller: true, needsCrib: false, needsKidsMeal: true, childTicketDiscount: 'under 12', seatPreference: 'window', bedPreference: 'twin', accessibilityNeeds: 'step free', roomNotes: 'quiet', notes: 'test' });
		await call('roamarr_journal_create', { tripId: trip.id, entryDate: '2026-07-12', title: 'Arrival', body: 'Landed safely' });
		await call('roamarr_home_task_create', { tripId: trip.id, text: 'Stop mail', dueDate: '2026-07-10' });
		await call('roamarr_medication_create', { tripId: trip.id, companionId: companion.id, name: 'Medicine', dosage: '5mg', schedule: 'daily', startsAt: '2026-07-12T08:00:00Z', endsAt: '2026-07-20T08:00:00Z', notes: 'with food' });
		await call('roamarr_important_item_create', { tripId: trip.id, companionId: companion.id, name: 'Camera', serialNumber: 'SN1', trackerId: 'AIR1', notes: 'carry on' });
		await call('roamarr_entry_requirement_create', { tripId: trip.id, country: 'JP', requirementType: 'visa', status: 'in_progress', dueDate: '2026-07-01', notes: 'online form' });
		await call('roamarr_doc_link_create', { tripId: trip.id, label: 'Voucher', url: 'https://example.com/voucher', notes: 'offline copy' });
		const companionRows = (await call('roamarr_companion_list', { tripId: trip.id })).items;
		expect(companionRows[0]).toMatchObject({ allergies: 'nuts', needsCarSeat: true, seatPreference: 'window', notes: 'test' });
		expect((await call('roamarr_journal_list', { tripId: trip.id })).items[0]).toMatchObject({ title: 'Arrival', body: 'Landed safely' });
		expect((await call('roamarr_home_task_list', { tripId: trip.id })).items[0]).toMatchObject({ text: 'Stop mail', dueDate: '2026-07-10' });
		expect((await call('roamarr_medication_list', { tripId: trip.id })).items[0]).toMatchObject({ companionId: companion.id, schedule: 'daily', notes: 'with food' });
		expect((await call('roamarr_important_item_list', { tripId: trip.id })).items[0]).toMatchObject({ name: 'Camera', serialNumber: 'SN1', trackerId: 'AIR1' });
		expect((await call('roamarr_entry_requirement_list', { tripId: trip.id })).items[0]).toMatchObject({ country: 'JP', requirementType: 'visa', status: 'in_progress', dueDate: '2026-07-01' });
		expect((await call('roamarr_doc_link_list', { tripId: trip.id })).items[0]).toMatchObject({ label: 'Voucher', notes: 'offline copy' });
	});

	test('entry requirement update validates status, dueDate, and notes', async () => {
		const trip = tripsRepo.createTrip(userId, { name: 'Requirement trip' });
		const { client } = await connect(userId, ['requirements:read', 'requirements:write']);
		const created: any = await client.callTool({
			name: 'roamarr_entry_requirement_create',
			arguments: { tripId: trip.id, country: 'JP', requirementType: 'visa', status: 'in_progress', dueDate: '2026-07-01', notes: 'online form' }
		});
		expect(created.isError).toBeFalsy();
		const requirementId = JSON.parse(created.content[0].text).id;

		const listRow = async () => {
			const listed: any = await client.callTool({ name: 'roamarr_entry_requirement_list', arguments: { tripId: trip.id } });
			return JSON.parse(listed.content[0].text).items[0];
		};

		const badStatus: any = await client.callTool({ name: 'roamarr_entry_requirement_update', arguments: { requirementId, status: 'done' } });
		expect(badStatus.isError).toBe(true);
		expect((await listRow()).status).toBe('in_progress');

		const badDate: any = await client.callTool({ name: 'roamarr_entry_requirement_update', arguments: { requirementId, dueDate: 'soon' } });
		expect(badDate.isError).toBe(true);
		expect((await listRow()).dueDate).toBe('2026-07-01');

		const badNotes: any = await client.callTool({ name: 'roamarr_entry_requirement_update', arguments: { requirementId, notes: 'x'.repeat(2001) } });
		expect(badNotes.isError).toBe(true);
		expect((await listRow()).notes).toBe('online form');

		const partial: any = await client.callTool({ name: 'roamarr_entry_requirement_update', arguments: { requirementId, notes: 'bring photos' } });
		expect(partial.isError).toBeFalsy();
		const partialRow = await listRow();
		expect(partialRow.notes).toBe('bring photos');
		expect(partialRow.status).toBe('in_progress');
		expect(partialRow.dueDate).toBe('2026-07-01');

		const full: any = await client.callTool({ name: 'roamarr_entry_requirement_update', arguments: { requirementId, status: 'complete', dueDate: '2026-08-15', notes: '' } });
		expect(full.isError).toBeFalsy();
		const fullRow = await listRow();
		expect(fullRow.status).toBe('complete');
		expect(fullRow.dueDate).toBe('2026-08-15');
		expect(fullRow.notes).toBeNull();

		const cleared: any = await client.callTool({ name: 'roamarr_entry_requirement_update', arguments: { requirementId, dueDate: '' } });
		expect(cleared.isError).toBeFalsy();
		expect((await listRow()).dueDate).toBeNull();

		const badId: any = await client.callTool({ name: 'roamarr_entry_requirement_update', arguments: { requirementId: 'abc' } });
		expect(badId.isError).toBe(true);
		expect(badId.content[0].text).toContain('requirementId');

		const otherId = makeUser(ctx.kit).id;
		const { client: otherClient } = await connect(otherId, ['requirements:read', 'requirements:write']);
		const denied: any = await otherClient.callTool({ name: 'roamarr_entry_requirement_update', arguments: { requirementId, notes: 'hijacked' } });
		expect(denied.isError).toBe(true);
		const unchanged = await listRow();
		expect(unchanged.status).toBe('complete');
		expect(unchanged.dueDate).toBeNull();
		expect(unchanged.notes).toBeNull();
	});

	test('mail hold tools enforce scopes, confirmation, and coverage', async () => {
		const trip = tripsRepo.createTrip(userId, { name: 'Mail trip', startDate: '2026-09-01', endDate: '2026-09-20' });
		const denied = await connect(userId, ['trips:read']);
		const missing: any = await denied.client.callTool({ name: 'roamarr_mail_hold_list', arguments: { tripId: trip.id } });
		expect(missing.isError).toBe(true);
		expect(missing.content[0].text).toContain('mail-holds:read');

		const { client } = await connect(userId, ['mail-holds:read', 'mail-holds:write']);
		const call = async (name: string, arguments_: Record<string, unknown>) => {
			const result: any = await client.callTool({ name, arguments: arguments_ });
			expect(result.isError, result.content?.[0]?.text).toBeFalsy();
			return JSON.parse(result.content[0].text);
		};
		const created = await call('roamarr_mail_hold_create', {
			tripId: trip.id,
			startDate: '2026-09-01',
			endDate: '2026-10-15',
			confirmationNumber: 'HOLDSECRET',
			addressLabel: 'HOMEADDR'
		});
		expect(created.warning).toMatch(/30 days/);
		expect(created.hold.confirmationNumber).toBeNull();
		const listed = await call('roamarr_mail_hold_list', { tripId: trip.id });
		expect(listed.items[0].addressLabel).toBe('HOMEADDR');
		expect(listed.items[0].confirmationNumber).toBeNull();
		expect(JSON.stringify(listed)).not.toContain('HOLDSECRET');
		const coverage = await call('roamarr_mail_hold_coverage', { tripId: trip.id });
		expect(coverage.awayDatesKnown).toBe(true);
		expect(coverage.renewals[0].renewalDate).toBe('2026-10-15');

		const viewerId = makeUser(ctx.kit).id;
		tripsRepo.createShare({ tripId: trip.id, sharedWithUserId: viewerId, permission: 'read' });
		const viewer = await connect(viewerId, ['mail-holds:read', 'mail-holds:write']);
		const hidden: any = await viewer.client.callTool({ name: 'roamarr_mail_hold_list', arguments: { tripId: trip.id } });
		expect(hidden.isError).toBe(true);
		expect(hidden.content[0].text).not.toContain('HOMEADDR');
		expect(hidden.content[0].text).not.toContain('HOLDSECRET');
		const hiddenCoverage: any = await viewer.client.callTool({ name: 'roamarr_mail_hold_coverage', arguments: { tripId: trip.id } });
		expect(hiddenCoverage.isError).toBe(true);
		expect(hiddenCoverage.content[0].text).not.toContain('2026-10-15');

		const unconfirmed: any = await client.callTool({ name: 'roamarr_mail_hold_delete', arguments: { holdId: created.id } });
		expect(unconfirmed.isError).toBe(true);
		await call('roamarr_mail_hold_delete', { holdId: created.id, confirm: true });
		expect((await call('roamarr_mail_hold_list', { tripId: trip.id })).items).toHaveLength(0);
	});

	test('mail hold notes and confirmation numbers require PII consent', async () => {
		const trip = tripsRepo.createTrip(userId, { name: 'PII trip', startDate: '2026-09-01', endDate: '2026-09-20' });
		const { client } = await connect(userId, ['mail-holds:read', 'mail-holds:write']);

		const created: any = await client.callTool({
			name: 'roamarr_mail_hold_create',
			arguments: {
				tripId: trip.id,
				startDate: '2026-09-01',
				endDate: '2026-09-20',
				confirmationNumber: 'HOLDSECRET',
				notes: 'PRIVATE NOTE',
				addressLabel: 'HOMEADDR'
			}
		});
		expect(created.isError).toBeFalsy();
		expect(created.content[0].text).not.toContain('HOLDSECRET');
		expect(created.content[0].text).not.toContain('PRIVATE NOTE');
		const createdJson = JSON.parse(created.content[0].text);
		expect(createdJson.hold.confirmationNumber).toBeNull();
		expect(createdJson.hold.notes).toBeNull();

		const listed: any = await client.callTool({ name: 'roamarr_mail_hold_list', arguments: { tripId: trip.id } });
		expect(listed.isError).toBeFalsy();
		expect(listed.content[0].text).not.toContain('HOLDSECRET');
		expect(listed.content[0].text).not.toContain('PRIVATE NOTE');
		expect(JSON.parse(listed.content[0].text).items[0].notes).toBeNull();
		expect(JSON.parse(listed.content[0].text).items[0].confirmationNumber).toBeNull();

		const updated: any = await client.callTool({
			name: 'roamarr_mail_hold_update',
			arguments: { holdId: createdJson.id, addressLabel: 'WORKADDR' }
		});
		expect(updated.isError).toBeFalsy();
		expect(updated.content[0].text).not.toContain('HOLDSECRET');
		expect(updated.content[0].text).not.toContain('PRIVATE NOTE');
		const updatedJson = JSON.parse(updated.content[0].text);
		expect(updatedJson.hold.notes).toBeNull();
		expect(updatedJson.hold.confirmationNumber).toBeNull();
		expect(updatedJson.hold.addressLabel).toBe('WORKADDR');

		updateSettings({ allowMcpPii: true });
		const scoped = await connect(userId, ['mail-holds:read', 'mail-holds:write', 'private-details:read']);
		const listedPii: any = await scoped.client.callTool({ name: 'roamarr_mail_hold_list', arguments: { tripId: trip.id } });
		expect(listedPii.isError).toBeFalsy();
		const listedPiiJson = JSON.parse(listedPii.content[0].text);
		expect(listedPiiJson.items[0].confirmationNumber).toBe('HOLDSECRET');
		expect(listedPiiJson.items[0].notes).toBe('PRIVATE NOTE');

		const updatedPii: any = await scoped.client.callTool({
			name: 'roamarr_mail_hold_update',
			arguments: { holdId: createdJson.id, addressLabel: 'WORKADDR2' }
		});
		expect(updatedPii.isError).toBeFalsy();
		const updatedPiiJson = JSON.parse(updatedPii.content[0].text);
		expect(updatedPiiJson.hold.confirmationNumber).toBe('HOLDSECRET');
		expect(updatedPiiJson.hold.notes).toBe('PRIVATE NOTE');

		updateSettings({ allowMcpPii: false });
		const listedRedacted: any = await scoped.client.callTool({ name: 'roamarr_mail_hold_list', arguments: { tripId: trip.id } });
		expect(JSON.parse(listedRedacted.content[0].text).items[0].confirmationNumber).toBeNull();
		expect(JSON.parse(listedRedacted.content[0].text).items[0].notes).toBeNull();

		updateSettings({ allowMcpPii: true });
		const noScope = await connect(userId, ['mail-holds:read', 'mail-holds:write']);
		const listedNoScope: any = await noScope.client.callTool({ name: 'roamarr_mail_hold_list', arguments: { tripId: trip.id } });
		expect(JSON.parse(listedNoScope.content[0].text).items[0].confirmationNumber).toBeNull();
		expect(JSON.parse(listedNoScope.content[0].text).items[0].notes).toBeNull();

		updateSettings({ allowMcpPii: false });
	});

	test('mail hold update and delete reject invalid holdId', async () => {
		const trip = tripsRepo.createTrip(userId, { name: 'Validation trip', startDate: '2026-09-01', endDate: '2026-09-20' });
		const { client } = await connect(userId, ['mail-holds:read', 'mail-holds:write']);
		const created: any = await client.callTool({
			name: 'roamarr_mail_hold_create',
			arguments: { tripId: trip.id, startDate: '2026-09-01', endDate: '2026-09-10' }
		});
		expect(created.isError).toBeFalsy();
		const createdJson = JSON.parse(created.content[0].text);

		for (const badId of [0, -1, 1.5]) {
			const upd: any = await client.callTool({
				name: 'roamarr_mail_hold_update',
				arguments: { holdId: badId, addressLabel: 'X' }
			});
			expect(upd.isError).toBe(true);
			expect(upd.content[0].text).toContain('holdId must be a positive integer');

			const del: any = await client.callTool({
				name: 'roamarr_mail_hold_delete',
				arguments: { holdId: badId, confirm: true }
			});
			expect(del.isError).toBe(true);
			expect(del.content[0].text).toContain('holdId must be a positive integer');
		}

		const listed: any = await client.callTool({ name: 'roamarr_mail_hold_list', arguments: { tripId: trip.id } });
		expect(JSON.parse(listed.content[0].text).items).toHaveLength(1);
	});

	test('mail hold no-op update skips the write and the audit row', async () => {
		const trip = tripsRepo.createTrip(userId, { name: 'Noop trip', startDate: '2026-09-01', endDate: '2026-09-20' });
		const { client } = await connect(userId, ['mail-holds:read', 'mail-holds:write']);
		const call = async (name: string, arguments_: Record<string, unknown>) => {
			const result: any = await client.callTool({ name, arguments: arguments_ });
			expect(result.isError, result.content?.[0]?.text).toBeFalsy();
			return JSON.parse(result.content[0].text);
		};
		const countAudit = () =>
			ctx.kit.selectFrom(auditLogs).where(kitEq(auditLogs.user_id, BigInt(userId))).executeSync().length;

		const created = await call('roamarr_mail_hold_create', {
			tripId: trip.id,
			startDate: '2026-09-01',
			endDate: '2026-10-15',
			addressLabel: 'HOMEADDR'
		});
		const before = countAudit();
		const noop = await call('roamarr_mail_hold_update', { holdId: created.id });
		expect(noop.warning).toBe(created.warning);
		const listed = await call('roamarr_mail_hold_list', { tripId: trip.id });
		expect(noop.hold).toEqual(listed.items[0]);
		expect(countAudit()).toBe(before);

		await call('roamarr_mail_hold_update', { holdId: created.id, addressLabel: 'X' });
		expect(countAudit()).toBe(before + 1);
	});

	test('read-only collaborators can load every native planning workflow', async () => {
		const viewerId = makeUser(ctx.kit).id;
		const trip = tripsRepo.createTrip(userId, { name: 'Shared planning' });
		tripsRepo.createShare({ tripId: trip.id, sharedWithUserId: viewerId, permission: 'read' });
		addChecklistItem(userId, trip.id, 'Passport');
		const tools: Array<[string, Scope]> = [
			['roamarr_packing_list_build', 'packing:read'],
			['roamarr_expense_list', 'expenses:read'],
			['roamarr_budget_update', 'budgets:read'],
			['roamarr_companion_list', 'companions:read'],
			['roamarr_journal_list', 'journal:read'],
			['roamarr_home_task_list', 'home-tasks:read'],
			['roamarr_comment_list', 'comments:read'],
			['roamarr_doc_link_list', 'doc-links:read'],
			['roamarr_poll_list', 'polls:read']
		];
		for (const [name, scope] of tools) {
			const { client } = await connect(viewerId, [scope]);
			const result: any = await client.callTool({ name, arguments: { tripId: trip.id } });
			expect(result.isError, `${name}: ${result.content?.[0]?.text}`).toBeFalsy();
			if (name === 'roamarr_packing_list_build') expect(JSON.parse(result.content[0].text).items[0]).toMatchObject({ text: 'Passport', assignedToCompanionId: null, assignedToName: null });
		}
	});

	test('mobile custom reminders preserve exact user fields', async () => {
		const trip = tripsRepo.createTrip(userId, { name: 'Reminder trip' });
		const { client } = await connect(userId, ['reminders:read', 'reminders:write']);
		const created: any = await client.callTool({ name: 'roamarr_reminder_add', arguments: { reminderType: 'trip', refId: trip.id, name: 'Leave home', description: 'Take passports', fireAt: '2026-08-01T12:30:00Z' } });
		expect(created.isError).toBeFalsy();
		const reminderId = JSON.parse(created.content[0].text).id;
		await client.callTool({ name: 'roamarr_reminder_update', arguments: { reminderId, name: 'Leave now', description: 'Take all passports', fireAt: '2026-08-01T13:00:00Z' } });
		const listed: any = await client.callTool({ name: 'roamarr_reminder_list', arguments: {} });
		expect(JSON.parse(listed.content[0].text).items[0]).toMatchObject({ id: reminderId, name: 'Leave now', description: 'Take all passports', fireAt: '2026-08-01T13:00:00.000Z', refType: 'trip', refId: trip.id });
	});

	test('reminder_update validates refId shape and authorization', async () => {
		const bId = makeUser(ctx.kit).id;
		const bPrivateTrip = tripsRepo.createTrip(bId, { name: 'B private trip' });
		const sharedTrip = tripsRepo.createTrip(bId, { name: 'Shared trip' });
		tripsRepo.createShare({ tripId: sharedTrip.id, sharedWithUserId: userId, permission: 'read' });
		const aTrip = tripsRepo.createTrip(userId, { name: 'A trip' });
		upsertCustomReminder(userId, 'trip', aTrip.id, '2026-09-01T09:00:00Z', 60);
		const reminder = getReminderBySource('custom', 'trip', aTrip.id)!;
		const { client } = await connect(userId, ['reminders:write']);

		for (const bad of ['abc', '', 0, -1, 1.5]) {
			const before = getReminderById(reminder.id)!;
			const res: any = await client.callTool({ name: 'roamarr_reminder_update', arguments: { reminderId: reminder.id, refId: bad } });
			expect(res.isError, `refId ${JSON.stringify(bad)}`).toBe(true);
			const after = getReminderById(reminder.id)!;
			expect(after.refId).toBe(before.refId);
			expect(after.name).toBe(before.name);
			expect(after.description).toBe(before.description);
		}

		const before = getReminderById(reminder.id)!;
		const privateRes: any = await client.callTool({ name: 'roamarr_reminder_update', arguments: { reminderId: reminder.id, refId: bPrivateTrip.id } });
		expect(privateRes.isError).toBe(true);
		const afterPrivate = getReminderById(reminder.id)!;
		expect(afterPrivate.refId).toBe(before.refId);
		expect(afterPrivate.name).toBe(before.name);
		expect(afterPrivate.description).toBe(before.description);

		const sharedRes: any = await client.callTool({ name: 'roamarr_reminder_update', arguments: { reminderId: reminder.id, refId: sharedTrip.id } });
		expect(sharedRes.isError).toBeFalsy();
		expect(getReminderById(reminder.id)!.refId).toBe(sharedTrip.id);
	});

	test('reminder_update validates segment-scoped refId authorization', async () => {
		const bId = makeUser(ctx.kit).id;
		const bPrivateTrip = tripsRepo.createTrip(bId, { name: 'B private trip' });
		const bSegment = makeSegment(ctx.kit, bPrivateTrip.id, { title: 'B segment' });
		const aTrip = tripsRepo.createTrip(userId, { name: 'A trip' });
		const aSeg = makeSegment(ctx.kit, aTrip.id, { title: 'A segment' });
		upsertCustomReminder(userId, 'segment', aSeg.id, '2026-09-01T09:00:00Z', 60);
		const reminder = getReminderBySource('custom', 'segment', aSeg.id)!;
		const { client } = await connect(userId, ['reminders:write']);

		const before = getReminderById(reminder.id)!;
		const foreign: any = await client.callTool({ name: 'roamarr_reminder_update', arguments: { reminderId: reminder.id, refId: bSegment.id } });
		expect(foreign.isError).toBe(true);
		const afterForeign = getReminderById(reminder.id)!;
		expect(afterForeign.refId).toBe(before.refId);
		expect(afterForeign.name).toBe(before.name);
		expect(afterForeign.description).toBe(before.description);

		const missing: any = await client.callTool({ name: 'roamarr_reminder_update', arguments: { reminderId: reminder.id, refId: 999999 } });
		expect(missing.isError).toBe(true);
		const afterMissing = getReminderById(reminder.id)!;
		expect(afterMissing.refId).toBe(before.refId);
		expect(afterMissing.name).toBe(before.name);
		expect(afterMissing.description).toBe(before.description);

		const own: any = await client.callTool({ name: 'roamarr_reminder_update', arguments: { reminderId: reminder.id, refId: aSeg.id } });
		expect(own.isError).toBeFalsy();
		expect(getReminderById(reminder.id)!.refId).toBe(aSeg.id);
	});

	test('reminder_update rejects a foreign document-scoped refId', async () => {
		const bId = makeUser(ctx.kit).id;
		const bDoc = makeTravelDocument(ctx.kit, bId, { type: 'passport' });
		const aDoc = makeTravelDocument(ctx.kit, userId, { type: 'passport' });
		const reminder = createReminder({ userId, kind: 'custom', refType: 'document', refId: aDoc.id, fireAt: '2026-09-01T12:00:00Z', name: 'Doc reminder' });
		const { client } = await connect(userId, ['reminders:write']);

		const before = getReminderById(reminder.id)!;
		const res: any = await client.callTool({ name: 'roamarr_reminder_update', arguments: { reminderId: reminder.id, refId: bDoc.id } });
		expect(res.isError).toBe(true);
		const after = getReminderById(reminder.id)!;
		expect(after.refId).toBe(before.refId);
		expect(after.name).toBe(before.name);
		expect(after.description).toBe(before.description);
	});

	test('reminder_update enforces name and description length caps', async () => {
		const aTrip = tripsRepo.createTrip(userId, { name: 'A trip' });
		upsertCustomReminder(userId, 'trip', aTrip.id, '2026-09-01T09:00:00Z', 60);
		const reminder = getReminderBySource('custom', 'trip', aTrip.id)!;
		const { client } = await connect(userId, ['reminders:write']);

		const before = getReminderById(reminder.id)!;
		const longName: any = await client.callTool({ name: 'roamarr_reminder_update', arguments: { reminderId: reminder.id, name: 'x'.repeat(201) } });
		expect(longName.isError).toBe(true);
		const afterLongName = getReminderById(reminder.id)!;
		expect(afterLongName.refId).toBe(before.refId);
		expect(afterLongName.name).toBe(before.name);
		expect(afterLongName.description).toBe(before.description);

		const longNote: any = await client.callTool({ name: 'roamarr_reminder_update', arguments: { reminderId: reminder.id, description: 'y'.repeat(1001) } });
		expect(longNote.isError).toBe(true);
		const afterLongNote = getReminderById(reminder.id)!;
		expect(afterLongNote.refId).toBe(before.refId);
		expect(afterLongNote.name).toBe(before.name);
		expect(afterLongNote.description).toBe(before.description);

		const okName: any = await client.callTool({ name: 'roamarr_reminder_update', arguments: { reminderId: reminder.id, name: 'n'.repeat(200) } });
		expect(okName.isError).toBeFalsy();
		expect(getReminderById(reminder.id)!.name).toBe('n'.repeat(200));
	});

	test('reminder_update returns not found for a foreign reminder', async () => {
		const bId = makeUser(ctx.kit).id;
		const bTrip = tripsRepo.createTrip(bId, { name: 'B trip' });
		upsertCustomReminder(bId, 'trip', bTrip.id, '2026-09-01T09:00:00Z', 60);
		const bReminder = getReminderBySource('custom', 'trip', bTrip.id)!;
		const before = getReminderById(bReminder.id)!;
		const { client } = await connect(userId, ['reminders:write']);
		const res: any = await client.callTool({ name: 'roamarr_reminder_update', arguments: { reminderId: bReminder.id, name: 'Hijacked' } });
		expect(res.isError).toBe(true);
		expect(res.content[0].text).toContain('Reminder not found');
		const after = getReminderById(bReminder.id)!;
		expect(after.name).toBe(before.name);
		expect(after.description).toBe(before.description);
		expect(after.refId).toBe(before.refId);
	});

	test('reminder_update stores a fireAt-only change', async () => {
		const aTrip = tripsRepo.createTrip(userId, { name: 'A trip' });
		upsertCustomReminder(userId, 'trip', aTrip.id, '2026-09-01T09:00:00Z', 60);
		const reminder = getReminderBySource('custom', 'trip', aTrip.id)!;
		const { client } = await connect(userId, ['reminders:write']);
		const res: any = await client.callTool({ name: 'roamarr_reminder_update', arguments: { reminderId: reminder.id, fireAt: '2026-10-02T15:30:00Z' } });
		expect(res.isError).toBeFalsy();
		expect(getReminderById(reminder.id)!.fireAt).toBe(new Date('2026-10-02T15:30:00Z').toISOString());
	});

	test('reminder_add rejects malformed refId before any write', async () => {
		const trip = tripsRepo.createTrip(userId, { name: 'RefId trip' });
		const { client } = await connect(userId, ['reminders:write']);
		const countReminders = () =>
			ctx.kit.selectFrom(reminders).where(kitEq(reminders.user_id, BigInt(userId))).executeSync().length;
		const countAudit = () =>
			ctx.kit
				.selectFrom(auditLogs)
				.where(kitEq(auditLogs.user_id, BigInt(userId)))
				.executeSync()
				.filter((r: any) => r.action === 'mcp_reminder_add').length;
		const cases: Array<Record<string, unknown>> = [
			{},
			{ refId: null },
			{ refId: 'abc' },
			{ refId: '' },
			{ refId: 0 },
			{ refId: -1 },
			{ refId: 1.5 }
		];
		for (const extra of cases) {
			const before = countReminders();
			const auditBefore = countAudit();
			const res: any = await client.callTool({
				name: 'roamarr_reminder_add',
				arguments: { reminderType: 'trip', name: 'x', description: 'y', fireAt: '2026-08-01T12:30:00Z', ...extra }
			});
			expect(res.isError, JSON.stringify(extra)).toBe(true);
			expect(res.content[0].text).toContain('refId must be a positive integer');
			expect(countReminders()).toBe(before);
			expect(countAudit()).toBe(auditBefore);
		}
	});

	test('reminder_add authorizes trip and document references', async () => {
		const bId = makeUser(ctx.kit).id;
		const bPrivateTrip = tripsRepo.createTrip(bId, { name: 'B private trip' });
		const bDoc = makeTravelDocument(ctx.kit, bId, { type: 'passport' });
		const sharedTrip = tripsRepo.createTrip(bId, { name: 'Shared trip' });
		tripsRepo.createShare({ tripId: sharedTrip.id, sharedWithUserId: userId, permission: 'read' });
		const aDoc = makeTravelDocument(ctx.kit, userId, { type: 'passport' });
		const { client } = await connect(userId, ['reminders:write']);
		const countReminders = () =>
			ctx.kit.selectFrom(reminders).where(kitEq(reminders.user_id, BigInt(userId))).executeSync().length;
		const countAudit = () =>
			ctx.kit
				.selectFrom(auditLogs)
				.where(kitEq(auditLogs.user_id, BigInt(userId)))
				.executeSync()
				.filter((r: any) => r.action === 'mcp_reminder_add').length;
		const before = countReminders();
		const auditBefore = countAudit();

		const foreignTrip: any = await client.callTool({ name: 'roamarr_reminder_add', arguments: { reminderType: 'trip', name: 'x', description: 'y', fireAt: '2026-08-01T12:30:00Z', refId: bPrivateTrip.id } });
		expect(foreignTrip.isError).toBe(true);
		expect(countReminders()).toBe(before);
		expect(countAudit()).toBe(auditBefore);

		const foreignDoc: any = await client.callTool({ name: 'roamarr_reminder_add', arguments: { reminderType: 'document', name: 'x', description: 'y', fireAt: '2026-08-01T12:30:00Z', refId: bDoc.id } });
		expect(foreignDoc.isError).toBe(true);
		expect(countReminders()).toBe(before);
		expect(countAudit()).toBe(auditBefore);

		const shared: any = await client.callTool({ name: 'roamarr_reminder_add', arguments: { reminderType: 'trip', name: 'Shared', description: 'y', fireAt: '2026-08-01T12:30:00Z', refId: sharedTrip.id } });
		expect(shared.isError).toBeFalsy();
		const sharedId = JSON.parse(shared.content[0].text).id;
		const sharedRow = getReminderById(sharedId)!;
		expect(sharedRow.kind).toBe('custom');
		expect(sharedRow.refType).toBe('trip');
		expect(sharedRow.refId).toBe(sharedTrip.id);
		expect(sharedRow.userId).toBe(userId);

		const ownDoc: any = await client.callTool({ name: 'roamarr_reminder_add', arguments: { reminderType: 'document', name: 'Doc', description: 'y', fireAt: '2026-08-01T12:30:00Z', refId: aDoc.id } });
		expect(ownDoc.isError).toBeFalsy();
		const ownDocId = JSON.parse(ownDoc.content[0].text).id;
		expect(getReminderById(ownDocId)!.refType).toBe('document');
	});

	test('reminder_add rejects malformed name/description', async () => {
		const trip = tripsRepo.createTrip(userId, { name: 'Name trip' });
		const { client } = await connect(userId, ['reminders:write']);
		const countReminders = () =>
			ctx.kit.selectFrom(reminders).where(kitEq(reminders.user_id, BigInt(userId))).executeSync().length;
		const countAudit = () =>
			ctx.kit
				.selectFrom(auditLogs)
				.where(kitEq(auditLogs.user_id, BigInt(userId)))
				.executeSync()
				.filter((r: any) => r.action === 'mcp_reminder_add').length;
		const base: Record<string, unknown> = { reminderType: 'trip', fireAt: '2026-08-01T12:30:00Z', refId: trip.id };
		const before = countReminders();
		const auditBefore = countAudit();

		const missing: any = await client.callTool({ name: 'roamarr_reminder_add', arguments: { ...base, description: 'y' } });
		expect(missing.isError).toBe(true);
		expect(missing.content[0].text).toContain('name is required');

		const blank: any = await client.callTool({ name: 'roamarr_reminder_add', arguments: { ...base, name: '   ' } });
		expect(blank.isError).toBe(true);
		expect(blank.content[0].text).toContain('name is required');

		const numeric: any = await client.callTool({ name: 'roamarr_reminder_add', arguments: { ...base, name: 123 } });
		expect(numeric.isError).toBe(true);
		expect(numeric.content[0].text).toContain('name is required');

		const longName: any = await client.callTool({ name: 'roamarr_reminder_add', arguments: { ...base, name: 'x'.repeat(201) } });
		expect(longName.isError).toBe(true);
		expect(longName.content[0].text).toContain('name must be a string up to 200 chars');

		const numericDesc: any = await client.callTool({ name: 'roamarr_reminder_add', arguments: { ...base, name: 'ok', description: 123 } });
		expect(numericDesc.isError).toBe(true);
		expect(numericDesc.content[0].text).toContain('description must be a string up to 1000 chars');

		const longDesc: any = await client.callTool({ name: 'roamarr_reminder_add', arguments: { ...base, name: 'ok', description: 'y'.repeat(1001) } });
		expect(longDesc.isError).toBe(true);
		expect(longDesc.content[0].text).toContain('description must be a string up to 1000 chars');

		expect(countReminders()).toBe(before);
		expect(countAudit()).toBe(auditBefore);
	});

	test('reminder_add rejects malformed tripId (implicit branch)', async () => {
		const { client } = await connect(userId, ['reminders:write']);
		const countReminders = () =>
			ctx.kit.selectFrom(reminders).where(kitEq(reminders.user_id, BigInt(userId))).executeSync().length;
		const countAudit = () =>
			ctx.kit
				.selectFrom(auditLogs)
				.where(kitEq(auditLogs.user_id, BigInt(userId)))
				.executeSync()
				.filter((r: any) => r.action === 'mcp_reminder_add').length;
		const cases: Array<Record<string, unknown>> = [
			{},
			{ tripId: null },
			{ tripId: 'abc' },
			{ tripId: 0 },
			{ tripId: -1 },
			{ tripId: 1.5 }
		];
		for (const extra of cases) {
			const before = countReminders();
			const auditBefore = countAudit();
			const res: any = await client.callTool({ name: 'roamarr_reminder_add', arguments: { offsetMinutes: 60, ...extra } });
			expect(res.isError, JSON.stringify(extra)).toBe(true);
			expect(res.content[0].text).toContain('tripId must be a positive integer');
			expect(countReminders()).toBe(before);
			expect(countAudit()).toBe(auditBefore);
		}
	});

	test('reminder_add validates offsetMinutes (implicit branch)', async () => {
		const trip = tripsRepo.createTrip(userId, { name: 'Offset trip', startDate: '2026-09-01' });
		const { client } = await connect(userId, ['reminders:write']);
		const countAudit = () =>
			ctx.kit
				.selectFrom(auditLogs)
				.where(kitEq(auditLogs.user_id, BigInt(userId)))
				.executeSync()
				.filter((r: any) => r.action === 'mcp_reminder_add').length;

		for (const bad of ['abc', '', '   ', 1.5, 10081, -10081]) {
			const auditBefore = countAudit();
			const res: any = await client.callTool({ name: 'roamarr_reminder_add', arguments: { tripId: trip.id, offsetMinutes: bad } });
			expect(res.isError, JSON.stringify(bad)).toBe(true);
			expect(res.content[0].text).toContain('offsetMinutes must be an integer between -10080 and 10080');
			expect(getReminderBySource('custom', 'trip', trip.id)).toBeNull();
			expect(countAudit()).toBe(auditBefore);
		}

		const valid: Array<[Record<string, unknown>, string]> = [
			[{ tripId: trip.id }, '2026-09-01T08:00:00.000Z'],
			[{ tripId: trip.id, offsetMinutes: null }, '2026-09-01T08:00:00.000Z'],
			[{ tripId: trip.id, offsetMinutes: 10080 }, '2026-08-25T09:00:00.000Z'],
			[{ tripId: trip.id, offsetMinutes: -10080 }, '2026-09-08T09:00:00.000Z'],
			[{ tripId: trip.id, offsetMinutes: '90' }, '2026-09-01T07:30:00.000Z']
		];
		for (const [args, expected] of valid) {
			const res: any = await client.callTool({ name: 'roamarr_reminder_add', arguments: args });
			expect(res.isError, JSON.stringify(args)).toBeFalsy();
			const row = getReminderBySource('custom', 'trip', trip.id)!;
			expect(DateTime.fromISO(row.fireAt, { zone: 'utc' }).toUTC().toISO()).toBe(expected);
		}
	});

	test('reminder_update rejects blank offsetMinutes', async () => {
		const trip = tripsRepo.createTrip(userId, { name: 'Update trip', startDate: '2026-09-01' });
		upsertCustomReminder(userId, 'trip', trip.id, '2026-09-01T09:00:00Z', 60);
		const reminder = getReminderBySource('custom', 'trip', trip.id)!;
		const { client } = await connect(userId, ['reminders:write']);
		const countAudit = () =>
			ctx.kit
				.selectFrom(auditLogs)
				.where(kitEq(auditLogs.user_id, BigInt(userId)))
				.executeSync()
				.filter((r: any) => r.action === 'mcp_reminder_update').length;

		const auditBefore = countAudit();
		const blank: any = await client.callTool({ name: 'roamarr_reminder_update', arguments: { reminderId: reminder.id, offsetMinutes: '' } });
		expect(blank.isError).toBe(true);
		expect(blank.content[0].text).toContain('offsetMinutes must be an integer between -10080 and 10080');
		expect(getReminderById(reminder.id)!.fireAt).toBe(reminder.fireAt);
		expect(countAudit()).toBe(auditBefore);

		const ok: any = await client.callTool({ name: 'roamarr_reminder_update', arguments: { reminderId: reminder.id, offsetMinutes: 120 } });
		expect(ok.isError).toBeFalsy();
		expect(getReminderById(reminder.id)!.fireAt).toBe('2026-09-01T07:00:00.000Z');
	});

	test('reminder_delete validates id and authorizes ownership', async () => {
		const bId = makeUser(ctx.kit).id;
		const bTrip = tripsRepo.createTrip(bId, { name: 'B trip' });
		upsertCustomReminder(bId, 'trip', bTrip.id, '2026-09-01T09:00:00Z', 60);
		const bReminder = getReminderBySource('custom', 'trip', bTrip.id)!;
		const aTrip = tripsRepo.createTrip(userId, { name: 'A trip' });
		upsertCustomReminder(userId, 'trip', aTrip.id, '2026-09-01T09:00:00Z', 60);
		const aReminder = getReminderBySource('custom', 'trip', aTrip.id)!;
		const { client } = await connect(userId, ['reminders:write']);
		const countAudit = () =>
			ctx.kit
				.selectFrom(auditLogs)
				.where(kitEq(auditLogs.user_id, BigInt(userId)))
				.executeSync()
				.filter((r: any) => r.action === 'mcp_reminder_delete').length;

		const cases: Array<Record<string, unknown>> = [
			{},
			{ reminderId: null },
			{ reminderId: 'abc' },
			{ reminderId: 0 },
			{ reminderId: -1 },
			{ reminderId: 1.5 }
		];
		for (const extra of cases) {
			const auditBefore = countAudit();
			const res: any = await client.callTool({ name: 'roamarr_reminder_delete', arguments: { confirm: true, ...extra } });
			expect(res.isError, JSON.stringify(extra)).toBe(true);
			expect(res.content[0].text).toContain('reminderId must be a positive integer');
			expect(getReminderById(aReminder.id)).not.toBeNull();
			expect(countAudit()).toBe(auditBefore);
		}

		const auditBeforeNoConfirm = countAudit();
		const noConfirm: any = await client.callTool({ name: 'roamarr_reminder_delete', arguments: { reminderId: aReminder.id } });
		expect(noConfirm.isError).toBe(true);
		expect(getReminderById(aReminder.id)).not.toBeNull();
		expect(countAudit()).toBe(auditBeforeNoConfirm);

		const foreign: any = await client.callTool({ name: 'roamarr_reminder_delete', arguments: { reminderId: bReminder.id, confirm: true } });
		expect(foreign.isError).toBe(true);
		expect(getReminderById(bReminder.id)).not.toBeNull();
		expect(countAudit()).toBe(auditBeforeNoConfirm);

		const own: any = await client.callTool({ name: 'roamarr_reminder_delete', arguments: { reminderId: aReminder.id, confirm: true } });
		expect(own.isError).toBeFalsy();
		expect(getReminderById(aReminder.id)).toBeNull();
	});

	test('trip_list and trip_get derive status from dates and leave the saved status in place', async () => {
		const zone = 'America/Chicago';
		ctx.kit.updateTable(users).set({ timezone: zone }).where(kitEq(users.id, BigInt(userId))).executeSync();
		const today = DateTime.now().setZone(zone).toISODate()!;
		const yesterday = DateTime.fromISO(today).minus({ days: 1 }).toISODate()!;
		const tomorrow = DateTime.fromISO(today).plus({ days: 1 }).toISODate()!;
		const past = makeTrip(ctx.kit, userId, {
			name: 'Thailand, Aug 2026',
			startDate: DateTime.fromISO(today).minus({ months: 2 }).toISODate()!,
			endDate: yesterday,
			status: 'booked'
		});
		const endsToday = makeTrip(ctx.kit, userId, {
			name: 'Ends today',
			startDate: yesterday,
			endDate: today,
			status: 'booked'
		});
		const upcoming = makeTrip(ctx.kit, userId, {
			name: 'Later',
			startDate: tomorrow,
			endDate: DateTime.fromISO(tomorrow).plus({ days: 4 }).toISODate()!,
			status: 'planning'
		});

		const { client } = await connect(userId, ['trips:read', 'trips:write']);
		const listed: any = await client.callTool({ name: 'roamarr_trip_list', arguments: {} });
		expect(listed.isError).toBeFalsy();
		const items = JSON.parse(listed.content[0].text).items as Array<{ id: number; status: string }>;
		const statusById = new Map(items.map((item) => [item.id, item.status]));
		expect(statusById.get(past.id)).toBe('completed');
		expect(statusById.get(endsToday.id)).toBe('active');
		expect(statusById.get(upcoming.id)).toBe('planning');

		const got: any = await client.callTool({ name: 'roamarr_trip_get', arguments: { tripId: past.id } });
		expect(JSON.parse(got.content[0].text).trip.status).toBe('completed');

		const renamed: any = await client.callTool({
			name: 'roamarr_trip_update',
			arguments: { tripId: past.id, name: 'Thailand, Aug 2026 (notes)' }
		});
		expect(JSON.parse(renamed.content[0].text).status).toBe('completed');
		expect(tripsRepo.getTripById(past.id)).toMatchObject({ name: 'Thailand, Aug 2026 (notes)', status: 'booked' });
		expect(tripsRepo.getTripById(endsToday.id)?.status).toBe('booked');
		expect(tripsRepo.getTripById(upcoming.id)?.status).toBe('planning');
	});

	test('trips:write creates a trip owned by the token user', async () => {
		const { client } = await connect(userId, ['trips:write', 'trips:read']);
		const res: any = await client.callTool({ name: 'roamarr_trip_create', arguments: { name: 'Lisbon' } });
		expect(res.isError).toBeFalsy();
		const created = JSON.parse(res.content[0].text);
		const row = ctx.kit.selectFrom(trips).where(kitEq(trips.id, BigInt(created.id))).executeSync()[0];
		expect(row.owner_id).toBe(BigInt(userId));
		expect(row.name).toBe('Lisbon');
	});

	test('trip writes resolve destination city coordinates', async () => {
		travelDataRepo.importCitiesBatch([
			{ geonameId: 1609350, name: 'Bangkok', asciiName: 'Bangkok', countryCode: 'TH', lat: 13.7525, lng: 100.4942, population: 10539000, timezone: 'Asia/Bangkok' }
		]);
		const { client } = await connect(userId, ['trips:write']);
		const created: any = await client.callTool({
			name: 'roamarr_trip_create',
			arguments: { name: 'Thailand', destinationCountryCode: 'TH', destinationCityName: 'bangkok' }
		});
		const tripId = JSON.parse(created.content[0].text).id;
		expect(tripsRepo.getTripById(tripId)).toMatchObject({
			destinationCityName: 'Bangkok',
			destinationCityLat: 13.7525,
			destinationCityLng: 100.4942
		});

		await client.callTool({
			name: 'roamarr_trip_update',
			arguments: { tripId, destinationCityName: 'Bangkok' }
		});
		expect(tripsRepo.getTripById(tripId)).toMatchObject({
			destinationCityLat: 13.7525,
			destinationCityLng: 100.4942
		});
	});

	test('trip_update metadata-only does not wipe destination coords when city DB is empty', async () => {
		// Pre-seeded trip with coords; empty geonames table so findCity cannot re-resolve.
		const trip = tripsRepo.createTrip(userId, {
			name: 'Keep coords',
			destinationCountryCode: 'US',
			destinationAdmin1Code: 'TX',
			destinationCityName: 'Dallas',
			destinationCityLat: 32.78,
			destinationCityLng: -96.8
		});
		const { client } = await connect(userId, ['trips:write']);
		await client.callTool({
			name: 'roamarr_trip_update',
			arguments: { tripId: trip.id, name: 'Renamed only', notes: 'no destination fields' }
		});
		expect(tripsRepo.getTripById(trip.id)).toMatchObject({
			name: 'Renamed only',
			destinationCountryCode: 'US',
			destinationAdmin1Code: 'TX',
			destinationCityName: 'Dallas',
			destinationCityLat: 32.78,
			destinationCityLng: -96.8
		});
	});

	test('trip_update with unknown city name under admin1 does not null out stored coords', async () => {
		travelDataRepo.importCitiesBatch([
			{
				geonameId: 2,
				name: 'Dallas',
				asciiName: 'Dallas',
				countryCode: 'US',
				admin1Code: 'TX',
				lat: 32.78,
				lng: -96.8,
				population: 1300000,
				timezone: 'America/Chicago'
			}
		]);
		const trip = tripsRepo.createTrip(userId, {
			name: 'Existing',
			destinationCountryCode: 'US',
			destinationAdmin1Code: 'TX',
			destinationCityName: 'Dallas',
			destinationCityLat: 32.78,
			destinationCityLng: -96.8
		});
		const { client } = await connect(userId, ['trips:write']);
		// Name that does not match under admin1 — must not wipe prior lat/lng
		await client.callTool({
			name: 'roamarr_trip_update',
			arguments: {
				tripId: trip.id,
				destinationCountryCode: 'US',
				destinationAdmin1Code: 'TX',
				destinationCityName: 'NotARealCityXYZ'
			}
		});
		const row = tripsRepo.getTripById(trip.id)!;
		expect(row.destinationCityName).toBe('NotARealCityXYZ');
		expect(row.destinationCityLat).toBe(32.78);
		expect(row.destinationCityLng).toBe(-96.8);
	});

	test('trip and segment MCP tools accept admin1 and resolve within subdivision', async () => {
		travelDataRepo.importAdmin1Batch([
			{ countryCode: 'US', admin1Code: 'TX', name: 'Texas', asciiName: 'Texas' },
			{ countryCode: 'US', admin1Code: 'GA', name: 'Georgia', asciiName: 'Georgia' }
		]);
		travelDataRepo.importCitiesBatch([
			{
				geonameId: 1,
				name: 'Dallas',
				asciiName: 'Dallas',
				countryCode: 'US',
				admin1Code: 'GA',
				lat: 33.92,
				lng: -84.84,
				population: 14000,
				timezone: 'America/New_York'
			},
			{
				geonameId: 2,
				name: 'Dallas',
				asciiName: 'Dallas',
				countryCode: 'US',
				admin1Code: 'TX',
				lat: 32.78,
				lng: -96.8,
				population: 1300000,
				timezone: 'America/Chicago'
			}
		]);
		const { client } = await connect(userId, ['trips:write', 'trips:read', 'segments:write']);
		const created: any = await client.callTool({
			name: 'roamarr_trip_create',
			arguments: {
				name: 'Texas',
				destinationCountryCode: 'US',
				destinationAdmin1Code: 'TX',
				destinationCityName: 'dallas'
			}
		});
		const tripId = JSON.parse(created.content[0].text).id;
		expect(tripsRepo.getTripById(tripId)).toMatchObject({
			destinationAdmin1Code: 'TX',
			destinationCityName: 'Dallas',
			destinationCityLat: 32.78,
			destinationCityLng: -96.8
		});

		const planned: any = await client.callTool({
			name: 'roamarr_day_plan',
			arguments: {
				tripId,
				type: 'hotel',
				title: 'Stay',
				startAt: '2026-08-01T15:00:00',
				startTz: 'America/Chicago',
				countryCode: 'US',
				admin1Code: 'GA',
				cityName: 'Dallas'
			}
		});
		const segId = JSON.parse(planned.content[0].text).id;
		const { getSegmentById } = await import('./repositories/segmentsRepo');
		expect(getSegmentById(segId)).toMatchObject({
			admin1Code: 'GA',
			cityName: 'Dallas',
			cityLat: 33.92,
			cityLng: -84.84
		});

		// Read path: trip_get must return subdivision on trip + segments (criterion 4).
		const gotAfterPlan: any = await client.callTool({
			name: 'roamarr_trip_get',
			arguments: { tripId }
		});
		const bodyAfterPlan = JSON.parse(gotAfterPlan.content[0].text);
		expect(bodyAfterPlan.trip).toMatchObject({
			destinationAdmin1Code: 'TX',
			destinationCityName: 'Dallas'
		});
		expect(bodyAfterPlan.trip.segments).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					id: segId,
					admin1Code: 'GA',
					cityName: 'Dallas',
					countryCode: 'US'
				})
			])
		);

		const listed: any = await client.callTool({
			name: 'roamarr_trip_list',
			arguments: {}
		});
		const listBody = JSON.parse(listed.content[0].text);
		expect(listBody.items).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					id: tripId,
					destinationAdmin1Code: 'TX',
					destinationCityName: 'Dallas'
				})
			])
		);

		await client.callTool({
			name: 'roamarr_segment_update',
			arguments: {
				segmentId: segId,
				countryCode: 'US',
				admin1Code: 'TX',
				cityName: 'Dallas'
			}
		});
		expect(getSegmentById(segId)).toMatchObject({
			admin1Code: 'TX',
			cityLat: 32.78,
			cityLng: -96.8
		});

		const gotAfterUpdate: any = await client.callTool({
			name: 'roamarr_trip_get',
			arguments: { tripId }
		});
		const bodyAfterUpdate = JSON.parse(gotAfterUpdate.content[0].text);
		expect(bodyAfterUpdate.trip.segments).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					id: segId,
					admin1Code: 'TX',
					cityName: 'Dallas'
				})
			])
		);
	});

	test('trip_get includes itinerary segments for the owner', async () => {
		const trip = tripsRepo.createTrip(userId, { name: 'Itinerary', notes: 'Owner notes' });
		const { createSegment } = await import('./repositories/segmentsRepo');
		createSegment({ trip_id: BigInt(trip.id), type: 'event', title: 'Museum', start_at: '2026-08-01T10:00:00Z', start_tz: 'UTC' });
		const { client } = await connect(userId, ['trips:read']);
		const response: any = await client.callTool({ name: 'roamarr_trip_get', arguments: { tripId: trip.id } });
		const body = JSON.parse(response.content[0].text);
		expect(body.trip.segments).toHaveLength(1);
		expect(body.trip.segments[0].title).toBe('Museum');
		expect(body.trip).toMatchObject({ canEdit: true, owner: true });
		expect(body.trip.notes).toBeUndefined();
	});

	test('day plan and segment update preserve itinerary details', async () => {
		const trip = tripsRepo.createTrip(userId, { name: 'Hotel details' });
		const { client } = await connect(userId, ['segments:write']);
		const created: any = await client.callTool({
			name: 'roamarr_day_plan',
			arguments: {
				tripId: trip.id,
				type: 'hotel',
				title: 'Hotel',
				startAt: '2026-08-01T15:00:00',
				startTz: 'Asia/Bangkok',
				endAt: '2026-08-02T12:00:00',
				endTz: 'Asia/Bangkok',
				location: '123 Main St',
				confirmationNumber: 'ABC123',
				notes: 'Paid with travel credit',
				details: { room: 'Twin' },
				paymentStatus: 'fully_paid'
			}
		});
		const segmentId = JSON.parse(created.content[0].text).id;
		await client.callTool({
			name: 'roamarr_segment_update',
			arguments: {
				segmentId,
				startAt: '2026-08-01T16:00:00',
				startTz: 'Asia/Bangkok',
				endAt: '2026-08-02T11:00:00',
				endTz: 'Asia/Bangkok',
				details: { guests: '2' },
				notes: 'Updated note'
			}
		});
		const { getSegmentById } = await import('./repositories/segmentsRepo');
		const segment = getSegmentById(segmentId)!;
		expect(segment).toMatchObject({
			location: '123 Main St',
			venue: '123 Main St',
			startTz: 'Asia/Bangkok',
			endTz: 'Asia/Bangkok',
			startAt: '2026-08-01T09:00:00.000Z',
			endAt: '2026-08-02T04:00:00.000Z',
			confirmationNumber: 'ABC123',
			paymentStatus: 'fully_paid'
		});
		expect(JSON.parse(segment.detailsJson!)).toEqual({ room: 'Twin', guests: '2', notes: 'Updated note' });
	});

	test('day plan treats startAt digits as wall clock even when client sends trailing Z', async () => {
		// Regression: agents often emit ISO-with-Z; Z must not force absolute UTC.
		const trip = tripsRepo.createTrip(userId, { name: 'Wall clock Z' });
		const { client } = await connect(userId, ['segments:write']);
		const created: any = await client.callTool({
			name: 'roamarr_day_plan',
			arguments: {
				tripId: trip.id,
				type: 'flight',
				title: 'DFW evening depart',
				startAt: '2026-12-01T22:50:00.000Z',
				startTz: 'America/Chicago',
				endAt: '2026-12-03T05:25:00.000Z',
				endTz: 'Asia/Taipei'
			}
		});
		const segmentId = JSON.parse(created.content[0].text).id;
		const { getSegmentById } = await import('./repositories/segmentsRepo');
		const segment = getSegmentById(segmentId)!;
		// 22:50 America/Chicago in December (CST, UTC-6) → 04:50 UTC next calendar day
		expect(segment.startAt).toBe('2026-12-02T04:50:00.000Z');
		expect(segment.startTz).toBe('America/Chicago');
		// 05:25 Asia/Taipei (UTC+8) → 21:25 UTC previous calendar day
		expect(segment.endAt).toBe('2026-12-02T21:25:00.000Z');
		expect(segment.endTz).toBe('Asia/Taipei');
	});

	test('segment tools reject invalid timezones', async () => {
		const trip = tripsRepo.createTrip(userId, { name: 'Bad timezone' });
		const { client } = await connect(userId, ['segments:write']);
		const response: any = await client.callTool({
			name: 'roamarr_day_plan',
			arguments: {
				tripId: trip.id,
				type: 'hotel',
				title: 'Hotel',
				startAt: '2026-08-01T15:00:00',
				startTz: 'Mars/Olympus'
			}
		});
		expect(response.isError).toBe(true);
		expect(response.content[0].text).toContain('valid IANA timezone');
	});

	test('search finds trips by itinerary content', async () => {
		const trip = tripsRepo.createTrip(userId, { name: 'Summer' });
		const { createSegment } = await import('./repositories/segmentsRepo');
		createSegment({ trip_id: BigInt(trip.id), type: 'event', title: 'Hidden Museum', start_at: '2026-08-01T10:00:00Z', start_tz: 'UTC' });
		const { client } = await connect(userId, ['search:read']);
		const response: any = await client.callTool({ name: 'roamarr_search', arguments: { query: 'museum' } });
		expect(JSON.parse(response.content[0].text).trips).toEqual([expect.objectContaining({ id: trip.id })]);
	});

	test('search returns place hits with a projection, owner-only', async () => {
		const { hashEmbed, setTestEmbedFn } = await import('./embeddings/model');
		const { enableEmbeddings, disableEmbeddings } = await import('./embeddings/index');
		const { createPlace, createPlaceCategory } = await import('./places');
		const { searchDocuments } = await import('./db/mongrelSchema');
		setTestEmbedFn(async (text) => hashEmbed(text));
		try {
			const category = createPlaceCategory(userId, { name: 'Food & Drink' });
			const place = createPlace(userId, {
				name: 'Ramen Alley Stall',
				categoryId: category.id,
				lat: 43.06,
				lng: 141.35,
				description: 'miso butter corn ramen'
			});
			const otherUserId = makeUser(ctx.kit).id;
			createPlace(otherUserId, { name: 'Foreign Ramen Place', description: 'miso ramen' });
			await enableEmbeddings();

			const { client } = await connect(userId, ['search:read']);
			const response: any = await client.callTool({
				name: 'roamarr_search',
				arguments: { query: 'miso ramen stall' }
			});
			const payload = JSON.parse(response.content[0].text);
			expect(payload.semantic).toBe(true);
			const placeHits = payload.hits.filter((h: any) => h.entityType === 'place');
			expect(placeHits).toHaveLength(1);
			expect(placeHits[0].place).toEqual({
				id: place.id,
				name: 'Ramen Alley Stall',
				category: 'Food & Drink',
				lat: 43.06,
				lng: 141.35,
				status: 'planned'
			});
			expect(placeHits[0].snippet).toContain('miso butter corn ramen');
		} finally {
			await disableEmbeddings();
			setTestEmbedFn(null);
			ctx.kit.deleteFrom(searchDocuments).executeSync();
		}
	});

	test('weather overview returns null when trip lacks forecast coordinates', async () => {
		const trip = tripsRepo.createTrip(userId, { name: 'No coordinates' });
		const { client } = await connect(userId, ['trips:read']);
		const response: any = await client.callTool({ name: 'roamarr_weather_overview', arguments: { tripId: trip.id } });
		expect(response.isError).toBeFalsy();
		expect(JSON.parse(response.content[0].text)).toBeNull();
	});

	test('trip templates capture and recreate a source trip', async () => {
		const source = tripsRepo.createTrip(userId, { name: 'Source', destinationCityName: 'Paris' });
		const { client } = await connect(userId, ['templates:write']);
		const created: any = await client.callTool({ name: 'roamarr_trip_template_create', arguments: { name: 'Paris template', sourceTripId: source.id } });
		expect(created.isError).toBeFalsy();
		const templateId = JSON.parse(created.content[0].text).id;
		const applied: any = await client.callTool({ name: 'roamarr_trip_template_apply', arguments: { templateId } });
		expect(applied.isError).toBeFalsy();
		const newTripId = JSON.parse(applied.content[0].text).newTripId;
		expect(tripsRepo.getTripById(newTripId)?.destinationCityName).toBe('Paris');
	});

	test('packing_list_build cannot read another user’s trip (IDOR)', async () => {
		const other = makeUser(ctx.kit).id;
		const otherTrip = tripsRepo.createTrip(other, { name: 'Private' });
		const { client } = await connect(userId, ['packing:read']);
		// The dispatch wraps helper errors into an isError:true response
		// (per the codex batch 2 hardening) so the promise resolves
		// instead of rejecting. Assert on isError + the 404 message.
		const res: any = await client.callTool({
			name: 'roamarr_packing_list_build',
			arguments: { tripId: otherTrip.id }
		});
		expect(res.isError).toBe(true);
		expect(String(res.content?.[0]?.text ?? '')).toMatch(/404|Not found/);
	});

	test('places_list requires places:read', async () => {
		const { client } = await connect(userId, ['places:write']);
		const res: any = await client.callTool({ name: 'roamarr_places_list', arguments: {} });
		expect(res.isError).toBe(true);
		expect(res.content[0].text).toContain('places:read');
	});

	test('places_list works with places:read', async () => {
		const { markVisited } = await import('./visitedPlaces');
		markVisited(userId, 'country', 'PT', { source: 'manual' });
		const { client } = await connect(userId, ['places:read']);
		const res: any = await client.callTool({ name: 'roamarr_places_list', arguments: {} });
		expect(res.isError).toBeFalsy();
		const body = JSON.parse(res.content[0].text);
		expect(body.items.map((p: any) => p.code)).toContain('PT');
	});

	test('trip_update schema rejects cancelled status', async () => {
		const trip = tripsRepo.createTrip(userId, { name: 'Trip' });
		const { client } = await connect(userId, ['trips:write']);
		const res: any = await client.callTool({ name: 'roamarr_trip_update', arguments: { tripId: trip.id, status: 'cancelled' } });
		expect(res.isError).toBeFalsy();
		const text = res.content[0].text;
		expect(text).toContain('status must be one of');
		expect(text).not.toContain('cancelled');
	});

	test('trip_update: editor without showDetails cannot change notes', async () => {
		const trip = tripsRepo.createTrip(userId, { name: 'Original', notes: 'OWNER NOTES' });
		const editorId = makeUser(ctx.kit).id;
		tripsRepo.createShare({ tripId: trip.id, sharedWithUserId: editorId, permission: 'edit', showDetails: false });
		const { client } = await connect(editorId, ['trips:write']);

		const res: any = await client.callTool({
			name: 'roamarr_trip_update',
			arguments: { tripId: trip.id, name: 'Editor rename', notes: 'OVERWRITTEN' }
		});
		expect(String(res.content[0].text)).toContain('notes cannot be changed');
		expect(tripsRepo.getTripById(trip.id)).toMatchObject({ name: 'Original', notes: 'OWNER NOTES' });

		const resNull: any = await client.callTool({
			name: 'roamarr_trip_update',
			arguments: { tripId: trip.id, notes: null }
		});
		expect(String(resNull.content[0].text)).toContain('notes cannot be changed');
		expect(tripsRepo.getTripById(trip.id)).toMatchObject({ name: 'Original', notes: 'OWNER NOTES' });

		const auditRows = ctx.kit
			.selectFrom(auditLogs)
			.where(kitEq(auditLogs.entity_id, BigInt(trip.id)))
			.executeSync();
		expect(auditRows.filter((r: any) => r.action === 'mcp_trip_update')).toHaveLength(0);
	});

	test('trip_update: editor without showDetails is still rejected with private-details:read scope', async () => {
		const trip = tripsRepo.createTrip(userId, { name: 'Original', notes: 'OWNER NOTES' });
		const editorId = makeUser(ctx.kit).id;
		tripsRepo.createShare({ tripId: trip.id, sharedWithUserId: editorId, permission: 'edit', showDetails: false });
		const { client } = await connect(editorId, ['trips:write', 'private-details:read']);

		const res: any = await client.callTool({
			name: 'roamarr_trip_update',
			arguments: { tripId: trip.id, name: 'Editor rename', notes: 'OVERWRITTEN' }
		});
		expect(String(res.content[0].text)).toContain('notes cannot be changed');
		expect(tripsRepo.getTripById(trip.id)).toMatchObject({ name: 'Original', notes: 'OWNER NOTES' });
	});

	test('trip_update: editor without showDetails can edit non-private fields', async () => {
		const trip = tripsRepo.createTrip(userId, { name: 'Original', notes: 'OWNER NOTES' });
		const editorId = makeUser(ctx.kit).id;
		tripsRepo.createShare({ tripId: trip.id, sharedWithUserId: editorId, permission: 'edit', showDetails: false });
		const { client } = await connect(editorId, ['trips:write']);

		const res: any = await client.callTool({
			name: 'roamarr_trip_update',
			arguments: { tripId: trip.id, name: 'Editor rename' }
		});
		expect(res.isError).toBeFalsy();
		expect(tripsRepo.getTripById(trip.id)).toMatchObject({ name: 'Editor rename', notes: 'OWNER NOTES' });
	});

	test('trip_update: editor with showDetails can set and clear notes', async () => {
		const trip = tripsRepo.createTrip(userId, { name: 'Original', notes: 'OWNER NOTES' });
		const editorId = makeUser(ctx.kit).id;
		tripsRepo.createShare({ tripId: trip.id, sharedWithUserId: editorId, permission: 'edit', showDetails: true });
		const { client } = await connect(editorId, ['trips:write']);

		const setRes: any = await client.callTool({
			name: 'roamarr_trip_update',
			arguments: { tripId: trip.id, notes: 'EDITOR NOTES' }
		});
		expect(setRes.isError).toBeFalsy();
		expect(tripsRepo.getTripById(trip.id)?.notes).toBe('EDITOR NOTES');

		const clearRes: any = await client.callTool({
			name: 'roamarr_trip_update',
			arguments: { tripId: trip.id, notes: null }
		});
		expect(clearRes.isError).toBeFalsy();
		expect(tripsRepo.getTripById(trip.id)?.notes).toBeNull();
	});

	test('trip_update: owner sets and clears notes without private-details:read', async () => {
		const trip = tripsRepo.createTrip(userId, { name: 'Original' });
		const { client } = await connect(userId, ['trips:write']);

		const setRes: any = await client.callTool({
			name: 'roamarr_trip_update',
			arguments: { tripId: trip.id, notes: 'NEW' }
		});
		expect(setRes.isError).toBeFalsy();
		expect(tripsRepo.getTripById(trip.id)?.notes).toBe('NEW');

		const clearRes: any = await client.callTool({
			name: 'roamarr_trip_update',
			arguments: { tripId: trip.id, notes: '   ' }
		});
		expect(clearRes.isError).toBeFalsy();
		expect(tripsRepo.getTripById(trip.id)?.notes).toBeNull();
	});

	test('trip_update: a read-only viewer is rejected', async () => {
		const trip = tripsRepo.createTrip(userId, { name: 'Original', notes: 'OWNER NOTES' });
		const viewerId = makeUser(ctx.kit).id;
		tripsRepo.createShare({ tripId: trip.id, sharedWithUserId: viewerId, permission: 'read', showDetails: true });
		const { client } = await connect(viewerId, ['trips:write']);

		const res: any = await client.callTool({
			name: 'roamarr_trip_update',
			arguments: { tripId: trip.id, notes: 'x' }
		});
		expect(res.isError).toBe(true);
		expect(tripsRepo.getTripById(trip.id)).toMatchObject({ name: 'Original', notes: 'OWNER NOTES' });
	});

	test('trip_update rejects malformed fields and writes nothing', async () => {
		const trip = tripsRepo.createTrip(userId, {
			name: 'Original',
			notes: 'keep',
			startDate: '2026-03-10',
			endDate: '2026-03-20',
			baseCurrency: 'USD'
		});
		const { client } = await connect(userId, ['trips:write', 'trips:read']);

		const cases: Array<{ args: Record<string, unknown>; expected: string; notContain?: string }> = [
			{ args: { name: '' }, expected: 'name' },
			{ args: { name: '   ' }, expected: 'name' },
			{ args: { name: null }, expected: 'name' },
			{ args: { name: 42 }, expected: 'name' },
			{ args: { name: 'x'.repeat(201) }, expected: 'name' },
			{ args: { notes: 42 }, expected: 'notes must be' },
			{ args: { notes: 'n'.repeat(5001) }, expected: 'notes must be' },
			{ args: { startDate: 'not-a-date' }, expected: 'must be a valid date (YYYY-MM-DD)' },
			{ args: { endDate: '2026-02-30' }, expected: 'must be a valid date (YYYY-MM-DD)' },
			{ args: { startDate: 20260310 }, expected: 'must be a valid date (YYYY-MM-DD)' },
			{ args: { baseCurrency: 'EURO' }, expected: 'baseCurrency must be a 1-3 letter code' },
			{ args: { baseCurrency: 5 }, expected: 'baseCurrency must be a 1-3 letter code' },
			{ args: { defaultVisibility: 'banana' }, expected: 'defaultVisibility must be one of', notContain: 'banana' }
		];

		for (const { args, expected, notContain } of cases) {
			const res: any = await client.callTool({ name: 'roamarr_trip_update', arguments: { tripId: trip.id, ...args } });
			const text = String(res.content[0].text);
			expect(text).toContain(expected);
			if (notContain) expect(text).not.toContain(notContain);
			expect(tripsRepo.getTripById(trip.id)).toMatchObject({
				name: 'Original',
				notes: 'keep',
				startDate: '2026-03-10',
				endDate: '2026-03-20',
				baseCurrency: 'USD'
			});
		}

		const auditRows = ctx.kit
			.selectFrom(auditLogs)
			.where(kitEq(auditLogs.entity_id, BigInt(trip.id)))
			.executeSync();
		expect(auditRows.filter((r: any) => r.action === 'mcp_trip_update')).toHaveLength(0);
	});

	test('trip_update rejects an end date before the start date', async () => {
		const trip = tripsRepo.createTrip(userId, {
			name: 'Original',
			startDate: '2026-03-10',
			endDate: '2026-03-20'
		});
		const { client } = await connect(userId, ['trips:write', 'trips:read']);

		const inverted: any = await client.callTool({
			name: 'roamarr_trip_update',
			arguments: { tripId: trip.id, startDate: '2026-03-20', endDate: '2026-03-10' }
		});
		expect(String(inverted.content[0].text)).toContain('startDate must be on or before endDate');

		const againstStored: any = await client.callTool({
			name: 'roamarr_trip_update',
			arguments: { tripId: trip.id, endDate: '2026-03-01' }
		});
		expect(String(againstStored.content[0].text)).toContain('startDate must be on or before endDate');

		expect(tripsRepo.getTripById(trip.id)).toMatchObject({ startDate: '2026-03-10', endDate: '2026-03-20' });

		const equal: any = await client.callTool({
			name: 'roamarr_trip_update',
			arguments: { tripId: trip.id, startDate: '2026-03-10', endDate: '2026-03-10' }
		});
		expect(equal.isError).toBeFalsy();
		expect(tripsRepo.getTripById(trip.id)).toMatchObject({ startDate: '2026-03-10', endDate: '2026-03-10' });
	});

	test('trip_update leaves a legacy inverted trip editable', async () => {
		const trip = tripsRepo.createTrip(userId, {
			name: 'Original',
			startDate: '2026-03-10',
			endDate: '2026-03-01'
		});
		const { client } = await connect(userId, ['trips:write', 'trips:read']);

		const res: any = await client.callTool({
			name: 'roamarr_trip_update',
			arguments: { tripId: trip.id, name: 'Renamed' }
		});
		expect(res.isError).toBeFalsy();
		expect(tripsRepo.getTripById(trip.id)?.name).toBe('Renamed');
	});

	test('trip_update normalizes input', async () => {
		const trip = tripsRepo.createTrip(userId, {
			name: 'Original',
			startDate: '2026-03-10',
			endDate: '2026-03-20',
			baseCurrency: 'USD'
		});
		const { client } = await connect(userId, ['trips:write', 'trips:read']);

		const currency: any = await client.callTool({
			name: 'roamarr_trip_update',
			arguments: { tripId: trip.id, baseCurrency: ' eur ' }
		});
		expect(currency.isError).toBeFalsy();
		expect(tripsRepo.getTripById(trip.id)?.baseCurrency).toBe('EUR');

		const nullEnums: any = await client.callTool({
			name: 'roamarr_trip_update',
			arguments: { tripId: trip.id, defaultVisibility: null, status: null }
		});
		expect(nullEnums.isError).toBeFalsy();
		expect(tripsRepo.getTripById(trip.id)).toMatchObject({ defaultVisibility: 'private', status: 'booked' });

		const clearStart: any = await client.callTool({
			name: 'roamarr_trip_update',
			arguments: { tripId: trip.id, startDate: null }
		});
		expect(clearStart.isError).toBeFalsy();
		expect(tripsRepo.getTripById(trip.id)?.startDate).toBeNull();
	});

	test('trip_create rejects bad input and creates nothing', async () => {
		const { client } = await connect(userId, ['trips:write', 'trips:read']);
		const before = tripsRepo.listTripsForUser(userId).length;

		const cases: Array<{ args: Record<string, unknown>; expected: string; notContain?: string }> = [
			{ args: {}, expected: 'name is required' },
			{ args: { name: '' }, expected: 'name is required' },
			{ args: { name: 7 }, expected: 'name is required' },
			{ args: { name: 'Ok', status: 'banana' }, expected: 'status must be one of', notContain: 'banana' },
			{ args: { name: 'Ok', startDate: 'tomorrow' }, expected: 'must be a valid date (YYYY-MM-DD)' }
		];

		for (const { args, expected, notContain } of cases) {
			const res: any = await client.callTool({ name: 'roamarr_trip_create', arguments: args });
			const text = String(res.content[0].text);
			expect(text).toContain(expected);
			if (notContain) expect(text).not.toContain(notContain);
			expect(tripsRepo.listTripsForUser(userId).length).toBe(before);
		}
	});

	test('trip_create normalizes valid input', async () => {
		const { client } = await connect(userId, ['trips:write', 'trips:read']);
		const res: any = await client.callTool({
			name: 'roamarr_trip_create',
			arguments: {
				name: '  Lisbon  ',
				baseCurrency: 'eur',
				startDate: '2026-05-01',
				endDate: '2026-05-03',
				defaultVisibility: 'private',
				status: 'booked'
			}
		});
		expect(res.isError).toBeFalsy();
		const body = JSON.parse(res.content[0].text);
		const row = tripsRepo.getTripById(body.id);
		expect(row).toMatchObject({
			name: 'Lisbon',
			baseCurrency: 'EUR',
			startDate: '2026-05-01',
			endDate: '2026-05-03',
			defaultVisibility: 'private',
			status: 'booked'
		});
	});

	test('trip_delete requires confirm: true', async () => {
		const trip = makeTrip(ctx.kit, userId, { name: 'DeleteMe' });
		const { client } = await connect(userId, ['trips:write']);

		const omitted: any = await client.callTool({
			name: 'roamarr_trip_delete',
			arguments: { tripId: trip.id }
		});
		expect(omitted.isError).toBe(true);
		expect(String(omitted.content?.[0]?.text ?? '')).toContain('confirm');
		expect(tripsRepo.getTripById(trip.id)).toBeTruthy();

		for (const confirm of [false, 'true', 1]) {
			const res: any = await client.callTool({
				name: 'roamarr_trip_delete',
				arguments: { tripId: trip.id, confirm }
			});
			expect(res.isError).toBe(true);
			expect(String(res.content?.[0]?.text ?? '')).toContain('confirm');
			expect(tripsRepo.getTripById(trip.id)).toBeTruthy();
		}

		const auditRows = ctx.kit
			.selectFrom(auditLogs)
			.where(kitEq(auditLogs.entity_id, BigInt(trip.id)))
			.executeSync();
		expect(auditRows.filter((r: any) => r.action === 'mcp_trip_delete')).toHaveLength(0);
	});

	test('trip_delete rejects an invalid tripId before deleting anything', async () => {
		const trip = makeTrip(ctx.kit, userId, { name: 'DeleteMe' });
		const { client } = await connect(userId, ['trips:write']);

		const invalidArgs: Array<Record<string, unknown>> = [
			{},
			{ tripId: 'abc' },
			{ tripId: 0 },
			{ tripId: -1 },
			{ tripId: 1.5 },
			{ tripId: null },
			{ tripId: true },
			{ tripId: [7] }
		];
		for (const extra of invalidArgs) {
			const res: any = await client.callTool({
				name: 'roamarr_trip_delete',
				arguments: { confirm: true, ...extra }
			});
			expect(res.isError).toBe(true);
			expect(String(res.content?.[0]?.text ?? '')).toContain('tripId');
			expect(tripsRepo.getTripById(trip.id)).toBeTruthy();
		}

		const auditRows = ctx.kit
			.selectFrom(auditLogs)
			.where(kitEq(auditLogs.entity_id, BigInt(trip.id)))
			.executeSync();
		expect(auditRows.filter((r: any) => r.action === 'mcp_trip_delete')).toHaveLength(0);
	});

	test('trip_delete rejects another user’s trip (IDOR)', async () => {
		const other = makeUser(ctx.kit).id;
		const otherTrip = makeTrip(ctx.kit, other, { name: 'Theirs' });
		const { client } = await connect(userId, ['trips:write']);
		const res: any = await client.callTool({
			name: 'roamarr_trip_delete',
			arguments: { tripId: otherTrip.id, confirm: true }
		});
		expect(res.isError).toBe(true);
		expect(String(res.content?.[0]?.text ?? '')).toMatch(/not found/i);
		expect(tripsRepo.getTripById(otherTrip.id)).toBeTruthy();

		const auditRows = ctx.kit
			.selectFrom(auditLogs)
			.where(kitEq(auditLogs.entity_id, BigInt(otherTrip.id)))
			.executeSync();
		expect(
			auditRows.filter((r: any) => r.action === 'mcp_trip_delete' && Number(r.user_id) === userId)
		).toHaveLength(0);
	});

	test('trip_delete requires the trips:write scope', async () => {
		const trip = makeTrip(ctx.kit, userId, { name: 'DeleteMe' });
		const { client } = await connect(userId, ['trips:read']);
		const res: any = await client.callTool({
			name: 'roamarr_trip_delete',
			arguments: { tripId: trip.id, confirm: true }
		});
		expect(res.isError).toBe(true);
		expect(String(res.content?.[0]?.text ?? '')).toContain('trips:write');
		expect(tripsRepo.getTripById(trip.id)).toBeTruthy();
	});

	test('trip_delete removes the trip and writes an audit row', async () => {
		const trip = makeTrip(ctx.kit, userId, { name: 'DeleteMe' });
		const { client } = await connect(userId, ['trips:write']);
		const res: any = await client.callTool({
			name: 'roamarr_trip_delete',
			arguments: { tripId: trip.id, confirm: true }
		});
		expect(res.isError).toBeFalsy();
		const body = JSON.parse(res.content[0].text);
		expect(body.ok).toBe(true);
		expect(body.deleted).toBe(true);
		expect(tripsRepo.getTripById(trip.id)).toBeFalsy();

		const auditRows = ctx.kit
			.selectFrom(auditLogs)
			.where(kitEq(auditLogs.entity_id, BigInt(trip.id)))
			.executeSync();
		const mcpRows = auditRows.filter(
			(r: any) => r.action === 'mcp_trip_delete' && Number(r.user_id) === userId
		);
		expect(mcpRows).toHaveLength(1);
	});

	test('expense_update validates expenseId and money fields like expense_create', async () => {
		const trip = makeTrip(ctx.kit, userId, { name: 'Expenses' });
		const { addTripExpense } = await import('./tripExpenses/repository');
		const { getExpenseById } = await import('./repositories/expensesRepo');
		const created = addTripExpense(userId, trip.id, {
			description: 'Dinner',
			amount: 2500,
			currency: 'USD'
		});
		const { client } = await connect(userId, ['expenses:write']);

		const assertUnchanged = () => {
			const row = getExpenseById(created.id);
			expect(row).toBeTruthy();
			expect(row!.amount).toBe(2500);
			expect(row!.baseAmount).toBe(2500);
			expect(row!.exchangeRate).toBe(10000);
		};

		const invalidIds = [{ expenseId: 'abc' }, { expenseId: 1.5 }, { expenseId: 0 }, {}];
		for (const args of invalidIds) {
			const res: any = await client.callTool({ name: 'roamarr_expense_update', arguments: args });
			expect(res.isError).toBeTruthy();
			expect(String(res.content?.[0]?.text ?? '')).toContain('expenseId must be a positive integer');
			assertUnchanged();
		}

		const invalidMoney = [
			{ expenseId: created.id, baseAmount: -500 },
			{ expenseId: created.id, baseAmount: '3000' },
			{ expenseId: created.id, exchangeRate: true },
			{ exchangeRate: '11000' },
			{ expenseId: created.id, exchangeRate: '11000' }
		];
		for (const args of invalidMoney) {
			const res: any = await client.callTool({ name: 'roamarr_expense_update', arguments: args });
			expect(res.isError).toBeTruthy();
			assertUnchanged();
		}

		const baseAmountRes: any = await client.callTool({
			name: 'roamarr_expense_update',
			arguments: { expenseId: created.id, baseAmount: 3000 }
		});
		expect(baseAmountRes.isError).toBeFalsy();
		expect(getExpenseById(created.id)?.baseAmount).toBe(3000);

		const exchangeRateRes: any = await client.callTool({
			name: 'roamarr_expense_update',
			arguments: { expenseId: created.id, exchangeRate: 11000 }
		});
		expect(exchangeRateRes.isError).toBeFalsy();
		expect(getExpenseById(created.id)?.exchangeRate).toBe(11000);

		const descRes: any = await client.callTool({
			name: 'roamarr_expense_update',
			arguments: { expenseId: created.id, description: 'Supper' }
		});
		expect(descRes.isError).toBeFalsy();
		const finalRow = getExpenseById(created.id);
		expect(finalRow?.description).toBe('Supper');
		expect(finalRow?.baseAmount).toBe(3000);
		expect(finalRow?.exchangeRate).toBe(11000);
	});

	test('places_mark records ai source and ISO-3166-2 state codes', async () => {
		const { client } = await connect(userId, ['places:write', 'places:read']);
		const countryRes: any = await client.callTool({
			name: 'roamarr_places_mark',
			arguments: { kind: 'country', code: 'PT' }
		});
		expect(countryRes.isError).toBeFalsy();

		const stateRes: any = await client.callTool({
			name: 'roamarr_places_mark',
			arguments: { kind: 'state', code: 'US-CA' }
		});
		expect(stateRes.isError).toBeFalsy();

		const rows = ctx.kit.selectFrom(visitedCountries).executeSync();
		expect(rows).toHaveLength(1);
		expect(rows[0].country_code).toBe('PT');
		expect(rows[0].source).toBe('ai');

		const stateRows = ctx.kit.selectFrom(visitedUsStates).executeSync();
		expect(stateRows).toHaveLength(1);
		expect(stateRows[0].state_code).toBe('US-CA');
		expect(stateRows[0].source).toBe('ai');
	});

	test('trip_get does not include segment confirmation numbers', async () => {
		const trip = tripsRepo.createTrip(userId, { name: 'Secret', notes: 'Private trip note' });
		const { createSegment } = await import('./repositories/segmentsRepo');
		createSegment({
			trip_id: BigInt(trip.id),
			type: 'flight',
			title: 'Flight',
			start_at: '2026-07-01T10:00:00Z',
			start_tz: 'America/Chicago',
			confirmation_number: 'ABC123',
			details_json: JSON.stringify({ recordLocator: 'XYZ' }),
			payment_status: 'fully_paid'
		} as any);

		const { client } = await connect(userId, ['trips:read']);
		const res: any = await client.callTool({ name: 'roamarr_trip_get', arguments: { tripId: trip.id } });
		const text = res.content[0].text;
		expect(text).toContain('Secret');
		expect(text).not.toContain('ABC123');
		expect(text).not.toContain('recordLocator');
		expect(text).not.toContain('Private trip note');

		const scoped = await connect(userId, ['trips:read', 'private-details:read']);
		const stillPrivate: any = await scoped.client.callTool({
			name: 'roamarr_trip_get',
			arguments: { tripId: trip.id }
		});
		expect(stillPrivate.content[0].text).not.toContain('ABC123');

		updateSettings({ allowMcpPii: true });
		const shared: any = await scoped.client.callTool({
			name: 'roamarr_trip_get',
			arguments: { tripId: trip.id }
		});
		expect(shared.content[0].text).toContain('ABC123');
		expect(shared.content[0].text).toContain('recordLocator');
		expect(shared.content[0].text).toContain('Private trip note');
		expect(shared.content[0].text).toContain('America/Chicago');
		expect(shared.content[0].text).toContain('fully_paid');
	});

	test('profile_update with a single field preserves the others (read-then-merge)', async () => {
		const { client } = await connect(userId, ['profile-prefs:write']);
		const before = ctx.kit.selectFrom(users).where(kitEq(users.id, BigInt(userId))).executeSync()[0];
		const res: any = await client.callTool({
			name: 'roamarr_profile_update',
			arguments: { flightCheckinLeadHours: 48 }
		});
		expect(res.isError).toBeFalsy();
		const after = ctx.kit.selectFrom(users).where(kitEq(users.id, BigInt(userId))).executeSync()[0];
		expect(Number(after.flight_checkin_lead_hours)).toBe(48);
		expect(after.document_expiry_lead_days).toBe(before.document_expiry_lead_days);
		expect(after.timezone).toBe(before.timezone);
		expect(after.email).toBe(before.email);
		expect(after.theme_id).toBe(before.theme_id);
	});

	test('notification_channels_update with one arg preserves the other channel', async () => {
		const { client } = await connect(userId, ['notifications:write']);
		const res: any = await client.callTool({
			name: 'roamarr_notification_channels_update',
			arguments: { emailNotifications: false }
		});
		expect(res.isError).toBeFalsy();
		const after = ctx.kit.selectFrom(users).where(kitEq(users.id, BigInt(userId))).executeSync()[0];
		expect(after.email_notifications).toBe(false);
		expect(after.webhook_notifications).toBe(true);
		expect(after.email).toBeTruthy();
	});

	test('profile_update accepts and validates unit preferences', async () => {
		const { client } = await connect(userId, ['profile-prefs:write', 'profile-prefs:read']);
		const bad: any = await client.callTool({
			name: 'roamarr_profile_update',
			arguments: { temperatureUnit: 'kelvin' }
		});
		expect(bad.isError).toBe(true);

		const res: any = await client.callTool({
			name: 'roamarr_profile_update',
			arguments: { temperatureUnit: 'f', timeFormat: '12h' }
		});
		expect(res.isError).toBeFalsy();
		const got: any = await client.callTool({ name: 'roamarr_profile_get', arguments: {} });
		const profile = JSON.parse(got.content[0].text);
		expect(profile.temperatureUnit).toBe('f');
		expect(profile.timeFormat).toBe('12h');
		// Other preferences survive the merge.
		const after = ctx.kit.selectFrom(users).where(kitEq(users.id, BigInt(userId))).executeSync()[0];
		expect(after.timezone).toBeTruthy();
		expect(after.email).toBeTruthy();
	});

	test('notification_channels_update toggles ntfy without disturbing the other channels', async () => {
		const { client } = await connect(userId, ['notifications:write', 'notifications:read']);
		const res: any = await client.callTool({
			name: 'roamarr_notification_channels_update',
			arguments: { ntfyNotifications: false }
		});
		expect(res.isError).toBeFalsy();
		const after = ctx.kit.selectFrom(users).where(kitEq(users.id, BigInt(userId))).executeSync()[0];
		expect(after.ntfy_notifications).toBe(false);
		expect(after.email_notifications).toBe(true);
		expect(after.webhook_notifications).toBe(true);

		const got: any = await client.callTool({ name: 'roamarr_notification_channels_get', arguments: {} });
		const channels = JSON.parse(got.content[0].text);
		expect(channels.ntfyNotifications).toBe(false);
		expect(channels.emailNotifications).toBe(true);
	});

	test('card_update preserves notes when only the label is changed', async () => {
		const { createCard } = await import('./repositories/profileRepo');
		const card = createCard(userId, {
			network: 'visa',
			last4: '4242',
			nickname: 'Old',
			notes: 'call issuer before intl spend'
		});
		const { client } = await connect(userId, ['cards:write']);
		const res: any = await client.callTool({
			name: 'roamarr_card_update',
			arguments: { cardId: card.id, label: 'Personal' }
		});
		expect(res.isError).toBeFalsy();
		const { getCardById } = await import('./repositories/profileRepo');
		const after = getCardById(card.id, userId)!;
		expect(after.nickname).toBe('Personal');
		expect(after.notes).toBe('call issuer before intl spend');
		expect(after.last4).toBe('4242');
	});

	test('loyalty_update preserves balance and notes on partial update', async () => {
		const { createLoyaltyProgram, getLoyaltyProgramById } = await import('./repositories/profileRepo');
		const l = createLoyaltyProgram(userId, {
			programName: 'SkyMiles',
			membershipNumber: 'ABC123',
			balance: 50_000,
			notes: 'medallion'
		});
		const { client } = await connect(userId, ['loyalty:write']);
		const res: any = await client.callTool({
			name: 'roamarr_loyalty_update',
			arguments: { loyaltyId: l.id, memberNumber: 'XYZ789' }
		});
		expect(res.isError).toBeFalsy();
		const after = getLoyaltyProgramById(l.id, userId)!;
		expect(after.membershipNumber).toBe('XYZ789');
		expect(after.balance).toBe(50_000);
		expect(after.notes).toBe('medallion');
	});

	test('insurance_update preserves coverage, dates, and trip linkage', async () => {
		const { createInsurancePolicy, getInsurancePolicyById } = await import('./repositories/profileRepo');
		const trip = tripsRepo.createTrip(userId, { name: ' insured trip' });
		const p = createInsurancePolicy(userId, {
			provider: 'Allianz',
			policyNumber: 'P1',
			coverageSummary: 'medical + evacuation',
			coverageAmount: 100000,
			currency: 'USD',
			startDate: '2026-08-01',
			endDate: '2026-08-31',
			tripId: trip.id,
			notes: 'primary policy'
		});
		const { client } = await connect(userId, ['insurance:write']);
		const res: any = await client.callTool({
			name: 'roamarr_insurance_update',
			arguments: { insuranceId: p.id, provider: 'WorldNomads' }
		});
		expect(res.isError).toBeFalsy();
		const after = getInsurancePolicyById(p.id, userId)!;
		expect(after.provider).toBe('WorldNomads');
		expect(after.coverageSummary).toBe('medical + evacuation');
		expect(after.coverageAmount).toBe(100000);
		expect(after.currency).toBe('USD');
		expect(after.startDate).toBe('2026-08-01');
		expect(after.endDate).toBe('2026-08-31');
		expect(after.tripId).toBe(trip.id);
		expect(after.notes).toBe('primary policy');
	});

	test('travel_doc_update preserves notes and companion linkage', async () => {
		const { createTravelDocument, getTravelDocumentById } = await import('./repositories/profileRepo');
		const trip = tripsRepo.createTrip(userId, { name: 'doc trip' });
		const { insertTripCompanion } = await import('./tripCompanions');
		const companion = insertTripCompanion(userId, trip.id, { name: 'Spouse' });
		const d = createTravelDocument(userId, {
			type: 'passport',
			number: 'P123',
			issuingAuthority: 'USA',
			expiresOn: '2030-01-01',
			notes: 'renew early',
			companionId: companion.id
		});
		const { client } = await connect(userId, ['travel-docs:write']);
		const res: any = await client.callTool({
			name: 'roamarr_travel_doc_update',
			arguments: { docId: d.id, expiresOn: '2031-06-01' }
		});
		expect(res.isError).toBeFalsy();
		const after = getTravelDocumentById(d.id, userId)!;
		expect(after.expiresOn).toBe('2031-06-01');
		expect(after.notes).toBe('renew early');
		expect(after.companionId).toBe(companion.id);
	});

	test('doc_link_update with only a label preserves the stored url and notes', async () => {
		const trip = tripsRepo.createTrip(userId, { name: 'Doc link trip' });
		const { client } = await connect(userId, ['doc-links:read', 'doc-links:write']);
		const created: any = await client.callTool({
			name: 'roamarr_doc_link_create',
			arguments: { tripId: trip.id, label: 'Voucher', url: 'https://example.com/voucher', notes: 'offline copy' }
		});
		expect(created.isError).toBeFalsy();
		const linkId = JSON.parse(created.content[0].text).id;
		const res: any = await client.callTool({
			name: 'roamarr_doc_link_update',
			arguments: { linkId, label: 'Boarding passes' }
		});
		expect(res.isError, res.content?.[0]?.text).toBeFalsy();
		const { getDocumentLinkById } = await import('./repositories/tripMiscRepo');
		const after = getDocumentLinkById(linkId)!;
		expect(after).toMatchObject({ label: 'Boarding passes', url: 'https://example.com/voucher', notes: 'offline copy' });
	});

	test('doc_link_update with only linkId is a no-op and still validates label and url', async () => {
		const trip = tripsRepo.createTrip(userId, { name: 'Doc link trip' });
		const { client } = await connect(userId, ['doc-links:read', 'doc-links:write']);
		const created: any = await client.callTool({
			name: 'roamarr_doc_link_create',
			arguments: { tripId: trip.id, label: 'Voucher', url: 'https://example.com/voucher', notes: 'offline copy' }
		});
		expect(created.isError).toBeFalsy();
		const linkId = JSON.parse(created.content[0].text).id;
		const { getDocumentLinkById } = await import('./repositories/tripMiscRepo');

		const noop: any = await client.callTool({
			name: 'roamarr_doc_link_update',
			arguments: { linkId }
		});
		expect(noop.isError, noop.content?.[0]?.text).toBeFalsy();
		expect(getDocumentLinkById(linkId)).toMatchObject({ label: 'Voucher', url: 'https://example.com/voucher', notes: 'offline copy' });

		const badUrl: any = await client.callTool({
			name: 'roamarr_doc_link_update',
			arguments: { linkId, url: 'not-a-url' }
		});
		expect(badUrl.isError).toBe(true);
		expect(badUrl.content[0].text).toContain('URL must be a valid http or https URL');
		expect(getDocumentLinkById(linkId)).toMatchObject({ label: 'Voucher', url: 'https://example.com/voucher', notes: 'offline copy' });

		const badLabel: any = await client.callTool({
			name: 'roamarr_doc_link_update',
			arguments: { linkId, label: '' }
		});
		expect(badLabel.isError).toBe(true);
		expect(badLabel.content[0].text).toContain('Label is required');
		expect(getDocumentLinkById(linkId)).toMatchObject({ label: 'Voucher', url: 'https://example.com/voucher', notes: 'offline copy' });
	});

	test('doc_link_update updates or clears notes without touching label or url', async () => {
		const trip = tripsRepo.createTrip(userId, { name: 'Doc link trip' });
		const { client } = await connect(userId, ['doc-links:read', 'doc-links:write']);
		const created: any = await client.callTool({
			name: 'roamarr_doc_link_create',
			arguments: { tripId: trip.id, label: 'Voucher', url: 'https://example.com/voucher', notes: 'offline copy' }
		});
		expect(created.isError).toBeFalsy();
		const linkId = JSON.parse(created.content[0].text).id;
		const { getDocumentLinkById } = await import('./repositories/tripMiscRepo');

		const updated: any = await client.callTool({
			name: 'roamarr_doc_link_update',
			arguments: { linkId, notes: 'updated copy' }
		});
		expect(updated.isError, updated.content?.[0]?.text).toBeFalsy();
		expect(getDocumentLinkById(linkId)).toMatchObject({ label: 'Voucher', url: 'https://example.com/voucher', notes: 'updated copy' });

		const numeric: any = await client.callTool({
			name: 'roamarr_doc_link_update',
			arguments: { linkId, notes: 42 }
		});
		expect(numeric.isError, numeric.content?.[0]?.text).toBeFalsy();
		expect(getDocumentLinkById(linkId)).toMatchObject({ label: 'Voucher', url: 'https://example.com/voucher', notes: '42' });

		const cleared: any = await client.callTool({
			name: 'roamarr_doc_link_update',
			arguments: { linkId, notes: null }
		});
		expect(cleared.isError, cleared.content?.[0]?.text).toBeFalsy();
		const after = getDocumentLinkById(linkId)!;
		expect(after.notes).toBeNull();
		expect(after.label).toBe('Voucher');
		expect(after.url).toBe('https://example.com/voucher');
	});

	test('contact_update preserves relationship, email, and primary flag on partial update', async () => {
		const { createEmergencyContact, getEmergencyContactById } = await import('./repositories/profileRepo');
		const c = createEmergencyContact(userId, {
			name: 'Mom',
			relationship: 'parent',
			phone: '+15551234',
			email: 'mom@x.c',
			isPrimary: true
		});
		const { client } = await connect(userId, ['contacts:write']);
		const res: any = await client.callTool({
			name: 'roamarr_contact_update',
			arguments: { contactId: c.id, phone: '+19999999999' }
		});
		expect(res.isError).toBeFalsy();
		const after = getEmergencyContactById(c.id, userId)!;
		expect(after.phone).toBe('+19999999999');
		expect(after.name).toBe('Mom');
		expect(after.relationship).toBe('parent');
		expect(after.email).toBe('mom@x.c');
		expect(after.isPrimary).toBe(true);
	});

	describe('IDOR / cross-user enforcement', () => {
		test('card_update on another user’s card returns not-found (not the row)', async () => {
			const other = makeUser(ctx.kit).id;
			const { createCard } = await import('./repositories/profileRepo');
			const otherCard = createCard(other, { network: 'visa', last4: '9999', nickname: 'secret' });
			const { client } = await connect(userId, ['cards:write']);
			const res: any = await client.callTool({
				name: 'roamarr_card_update',
				arguments: { cardId: otherCard.id, label: 'hijacked' }
			});
			expect(res.isError).toBe(true);
			expect(String(res.content?.[0]?.text ?? '')).toMatch(/not found/i);
			// Original row untouched.
			const { getCardById } = await import('./repositories/profileRepo');
			expect(getCardById(otherCard.id, other)!.nickname).toBe('secret');
		});

		test('loyalty/insurance/travel_doc/contact delete on another user’s row is rejected', async () => {
			const other = makeUser(ctx.kit).id;
			const { createLoyaltyProgram, createInsurancePolicy, createTravelDocument, createEmergencyContact } =
				await import('./repositories/profileRepo');
			const l = createLoyaltyProgram(other, { programName: 'OtherMiles', membershipNumber: 'X' });
			const ins = createInsurancePolicy(other, { provider: 'OtherIns' });
			const doc = createTravelDocument(other, { type: 'passport', number: 'P-OTHER' });
			const ec = createEmergencyContact(other, { name: 'OtherMom' });

			const { client } = await connect(userId, [
				'loyalty:write',
				'insurance:write',
				'travel-docs:write',
				'contacts:write'
			]);
			for (const [tool, args] of [
				['roamarr_loyalty_delete', { loyaltyId: l.id, confirm: true }],
				['roamarr_insurance_delete', { insuranceId: ins.id, confirm: true }],
				['roamarr_travel_doc_delete', { docId: doc.id, confirm: true }],
				['roamarr_contact_delete', { contactId: ec.id, confirm: true }]
			] as const) {
				const res: any = await client.callTool({ name: tool as string, arguments: args as any });
				expect(res.isError).toBe(true);
				expect(String(res.content?.[0]?.text ?? '')).toMatch(/not found/i);
			}
		});

		test('poll_create rejects invalid input (empty question, single option) via createTripPoll', async () => {
			const trip = tripsRepo.createTrip(userId, { name: 'PollVal' });
			const { client } = await connect(userId, ['polls:write']);
			const res: any = await client.callTool({
				name: 'roamarr_poll_create',
				arguments: { tripId: trip.id, question: '', options: ['only'] }
			});
			expect(res.isError).toBe(true);
			const text = String(res.content?.[0]?.text ?? '');
			expect(text).toMatch(/400|at least 2|required/i);
		});

		test('poll_cast_vote on another user’s poll is rejected (IDOR)', async () => {
			const other = makeUser(ctx.kit).id;
			const otherTrip = tripsRepo.createTrip(other, { name: 'TheirTrip' });
			const { createTripPoll } = await import('./tripPolls');
			const poll = createTripPoll(other, otherTrip.id, 'Q?', ['a', 'b']);
			const optionId = poll.options[0]!.id;
			const { client } = await connect(userId, ['polls:write']);
			const res: any = await client.callTool({
				name: 'roamarr_poll_cast_vote',
				arguments: { pollId: poll.id, optionId }
			});
			expect(res.isError).toBe(true);
			expect(String(res.content?.[0]?.text ?? '')).toMatch(/404|not found/i);
		});

		test('trip_template_apply on another user’s template is rejected (IDOR)', async () => {
			const other = makeUser(ctx.kit).id;
			const otherTrip = tripsRepo.createTrip(other, { name: 'TplSrc' });
			const { createTripTemplate } = await import('./repositories/templatesRepo');
			const tpl = createTripTemplate({ userId: other, name: 'OtherTpl', sourceTripId: otherTrip.id, snapshot: { note: 'fixture' } });
			const { client } = await connect(userId, ['templates:write']);
			const res: any = await client.callTool({
				name: 'roamarr_trip_template_apply',
				arguments: { templateId: tpl.id }
			});
			expect(res.isError).toBe(true);
			expect(String(res.content?.[0]?.text ?? '')).toMatch(/not found/i);
		});

		test('companion_update on another user’s trip companion is rejected (IDOR)', async () => {
			const other = makeUser(ctx.kit).id;
			const otherTrip = tripsRepo.createTrip(other, { name: 'OtherC' });
			const { insertTripCompanion } = await import('./tripCompanions');
			const c = insertTripCompanion(other, otherTrip.id, { name: 'Spouse' });
			const { client } = await connect(userId, ['companions:write']);
			const res: any = await client.callTool({
				name: 'roamarr_companion_update',
				arguments: { companionId: c.id, name: 'hijacked' }
			});
			expect(res.isError).toBe(true);
			expect(String(res.content?.[0]?.text ?? '')).toMatch(/404|not found/i);
		});

		test('resources/read companion:// on another user’s trip is rejected (IDOR)', async () => {
			const other = makeUser(ctx.kit).id;
			const otherTrip = tripsRepo.createTrip(other, { name: 'OtherRes' });
			const { insertTripCompanion } = await import('./tripCompanions');
			const c = insertTripCompanion(other, otherTrip.id, { name: 'Private' });
			const { client } = await connect(userId, ['companions:read']);
			await expect(client.readResource({ uri: `companion://${c.id}` })).rejects.toThrow();
		});
	});

	describe('shared-trip access (editors and viewers)', () => {
		// Sets up: owner creates a trip with content; shares it with another
		// user (editor or viewer) via direct trip_share. Returns the editor/
		// viewer user id and the trip.
		let shareCounter = 0;
		function setupSharedTrip(permission: 'read' | 'edit', showDetails = false) {
			const n = ++shareCounter;
			const ownerId = makeUser(ctx.kit, { email: `owner-${n}@x.c` }).id;
			const otherId = makeUser(ctx.kit, { email: `other-${n}@x.c` }).id;
			const trip = tripsRepo.createTrip(ownerId, { name: `Shared-${n}` });
			tripsRepo.createShare({
				tripId: trip.id,
				sharedWithUserId: otherId,
				permission,
				showDetails
			});
			return { ownerId, otherId, trip };
		}

		test('editor can poll_list / expense_list / companion_list on shared trip', async () => {
			const { otherId, trip } = setupSharedTrip('edit');
			const { insertTripCompanion } = await import('./tripCompanions');
			insertTripCompanion(otherId, trip.id, { name: 'Ed' });
			const { client } = await connect(otherId, [
				'polls:read',
				'expenses:read',
				'companions:read'
			]);
			for (const t of [
				{ name: 'roamarr_poll_list', args: { tripId: trip.id } },
				{ name: 'roamarr_expense_list', args: { tripId: trip.id } },
				{ name: 'roamarr_companion_list', args: { tripId: trip.id } }
			]) {
				const res: any = await client.callTool({ name: t.name, arguments: t.args });
				expect(res.isError, `${t.name} should succeed for editor`).toBeFalsy();
			}
		});

		test('viewer (read-only share) can poll_list but poll_create is rejected', async () => {
			const { otherId, trip } = setupSharedTrip('read');
			const { client } = await connect(otherId, ['polls:read', 'polls:write']);
			// Read allowed
			const readRes: any = await client.callTool({
				name: 'roamarr_poll_list',
				arguments: { tripId: trip.id }
			});
			expect(readRes.isError).toBeFalsy();
			// Write rejected (viewer is not editor)
			const writeRes: any = await client.callTool({
				name: 'roamarr_poll_create',
				arguments: { tripId: trip.id, question: 'Q?', options: ['a', 'b'] }
			});
			expect(writeRes.isError).toBe(true);
		});

		test('editor can poll_cast_vote on shared trip (was previously owner-only)', async () => {
			const { ownerId, otherId, trip } = setupSharedTrip('edit');
			const { createTripPoll } = await import('./tripPolls');
			const poll = createTripPoll(ownerId, trip.id, 'Vote?', ['yes', 'no']);
			const optionYes = poll.options[0]!.id;
			const { client } = await connect(otherId, ['polls:write']);
			const res: any = await client.callTool({
				name: 'roamarr_poll_cast_vote',
				arguments: { pollId: poll.id, optionId: optionYes }
			});
			expect(res.isError).toBeFalsy();
			// Vote recorded against the editor's self-companion
			const { listPollsForTrip } = await import('./repositories/pollsRepo');
			const refreshed = listPollsForTrip(trip.id).find((p) => p.id === poll.id)!;
			expect(refreshed.options.find((o) => o.id === optionYes)!.voteCount).toBe(1);
		});

		test('non-share cannot read shared trip via requireViewableTrip', async () => {
			const ownerId = makeUser(ctx.kit, { email: 'owner2@x.c' }).id;
			const strangerId = makeUser(ctx.kit, { email: 'stranger@x.c' }).id;
			const trip = tripsRepo.createTrip(ownerId, { name: 'Private' });
			const { client } = await connect(strangerId, ['polls:read']);
			const res: any = await client.callTool({
				name: 'roamarr_poll_list',
				arguments: { tripId: trip.id }
			});
			expect(res.isError).toBe(true);
			expect(String(res.content?.[0]?.text ?? '')).toMatch(/404|not found/i);
		});

		test('share_list/calendar_rotate_token stay owner-only even with sharing/calendar scopes', async () => {
			const { otherId, trip } = setupSharedTrip('edit');
			const { client } = await connect(otherId, ['sharing:read', 'sharing:write', 'calendar:write']);
			const listRes: any = await client.callTool({
				name: 'roamarr_share_list',
				arguments: { tripId: trip.id }
			});
			expect(listRes.isError).toBe(true);
			const rotateRes: any = await client.callTool({
				name: 'roamarr_calendar_rotate_token',
				arguments: { tripId: trip.id }
			});
			expect(rotateRes.isError).toBe(true);
		});

		test('viewer can read companion:// resource for shared trip', async () => {
			const { ownerId, otherId, trip } = setupSharedTrip('read');
			const { insertTripCompanion } = await import('./tripCompanions');
			const c = insertTripCompanion(ownerId, trip.id, { name: 'Visible' });
			const { client } = await connect(otherId, ['companions:read']);
			const res = await client.readResource({ uri: `companion://${c.id}` });
			const text = (res.contents[0] as { text?: string })?.text ?? '';
			expect(text).toContain('Visible');
		});

		test('viewer reading companion:// gets private fields redacted (matches roamarr_companion_list)', async () => {
			const { ownerId, otherId, trip } = setupSharedTrip('read');
			const { insertTripCompanion } = await import('./tripCompanions');
			const c = insertTripCompanion(ownerId, trip.id, {
				name: 'Visible',
				medicalNotes: 'penicillin',
				allergies: 'peanut',
				dietary: 'vegetarian'
			});
			const { client } = await connect(otherId, ['companions:read']);
			const res = await client.readResource({ uri: `companion://${c.id}` });
			const text = (res.contents[0] as { text?: string })?.text ?? '';
			const companion = JSON.parse(text).companion;
			expect(companion.name).toBe('Visible');
			for (const field of COMPANION_PRIVATE_FIELDS) {
				expect(companion[field]).toBeNull();
			}
			expect(text).not.toContain('penicillin');
			expect(text).not.toContain('peanut');
			expect(text).not.toContain('vegetarian');
		});

		test('editor reading companion:// still gets the full row', async () => {
			const { ownerId, otherId, trip } = setupSharedTrip('edit');
			const { insertTripCompanion } = await import('./tripCompanions');
			const c = insertTripCompanion(ownerId, trip.id, {
				name: 'Visible',
				medicalNotes: 'penicillin',
				allergies: 'peanut',
				dietary: 'vegetarian'
			});
			const { client } = await connect(otherId, ['companions:read']);
			const res = await client.readResource({ uri: `companion://${c.id}` });
			const text = (res.contents[0] as { text?: string })?.text ?? '';
			const companion = JSON.parse(text).companion;
			expect(companion.name).toBe('Visible');
			expect(companion.medicalNotes).toBe('penicillin');
			expect(companion.allergies).toBe('peanut');
			expect(companion.dietary).toBe('vegetarian');
		});

		test('editor can trip_update shared trip metadata (matches web UI)', async () => {
			const { otherId, trip } = setupSharedTrip('edit');
			const { client } = await connect(otherId, ['trips:write']);
			const res: any = await client.callTool({
				name: 'roamarr_trip_update',
				arguments: { tripId: trip.id, name: 'Editor renamed' }
			});
			expect(res.isError).toBeFalsy();
			const after = tripsRepo.getTripById(trip.id);
			expect(after?.name).toBe('Editor renamed');
		});

		test('shared trips appear in roamarr_trip_list for the share recipient', async () => {
			const { otherId, trip } = setupSharedTrip('read');
			const { client } = await connect(otherId, ['trips:read']);
			const res: any = await client.callTool({ name: 'roamarr_trip_list', arguments: {} });
			const ids = JSON.parse(res.content[0].text).items.map((t: any) => t.id);
			expect(ids).toContain(trip.id);
		});

		test('shared trips appear in the trip-summary prompt for the share recipient', async () => {
			const { ownerId, otherId } = setupSharedTrip('read');
			// Set a far-future start date so the upcoming filter catches it.
			const trips_for_owner = tripsRepo.listViewableTripIdsForUser(ownerId);
			const tripId = trips_for_owner[trips_for_owner.length - 1]!;
			tripsRepo.updateTrip(tripId, { startDate: '2099-01-01', endDate: '2099-01-08' });
			const { client } = await connect(otherId, ['trips:read']);
			const res = await client.getPrompt({ name: 'trip-summary', arguments: {} });
			const text = res.messages[0]?.content?.type === 'text' ? res.messages[0].content.text : '';
			expect(text).toContain('2099-01-01');
		});

		test('read-only share viewer gets companions without private fields', async () => {
			const { ownerId, otherId, trip } = setupSharedTrip('read');
			const { insertTripCompanion } = await import('./tripCompanions');
			const companion = insertTripCompanion(ownerId, trip.id, {
				name: 'Sam',
				category: 'child',
				dietary: 'vegan marker',
				allergies: 'penicillin allergy',
				medicalNotes: 'medical notes marker',
				needsCarSeat: true,
				needsStroller: true,
				needsCrib: true,
				needsKidsMeal: true,
				childTicketDiscount: 'child ticket discount marker',
				seatPreference: 'seat preference marker',
				bedPreference: 'bed preference marker',
				accessibilityNeeds: 'accessibility needs marker',
				roomNotes: 'room notes marker',
				notes: 'private notes marker'
			});
			const { client } = await connect(otherId, ['companions:read']);
			const res: any = await client.callTool({ name: 'roamarr_companion_list', arguments: { tripId: trip.id } });
			expect(res.isError).toBeFalsy();
			const parsed = JSON.parse(res.content[0].text);
			const row = parsed.items.find((r: any) => r.id === companion.id);
			expect(row).toBeTruthy();
			expect(row.id).toBe(companion.id);
			expect(row.name).toBe('Sam');
			for (const field of COMPANION_PRIVATE_FIELDS) expect(row[field]).toBeNull();
			const serialized = res.content[0].text;
			for (const marker of [
				'vegan marker',
				'penicillin allergy',
				'medical notes marker',
				'child ticket discount marker',
				'seat preference marker',
				'bed preference marker',
				'accessibility needs marker',
				'room notes marker',
				'private notes marker'
			]) {
				expect(serialized).not.toContain(marker);
			}
		});

		test('owner and edit-share viewer get full companion rows', async () => {
			const { ownerId, otherId, trip } = setupSharedTrip('edit');
			const { insertTripCompanion } = await import('./tripCompanions');
			const companion = insertTripCompanion(ownerId, trip.id, {
				name: 'Sam',
				category: 'child',
				dietary: 'vegan marker',
				allergies: 'penicillin allergy',
				medicalNotes: 'medical notes marker',
				needsCarSeat: true,
				needsStroller: true,
				needsCrib: true,
				needsKidsMeal: true,
				childTicketDiscount: 'child ticket discount marker',
				seatPreference: 'seat preference marker',
				bedPreference: 'bed preference marker',
				accessibilityNeeds: 'accessibility needs marker',
				roomNotes: 'room notes marker',
				notes: 'private notes marker'
			});
			for (const [viewerId, label] of [
				[ownerId, 'owner'],
				[otherId, 'edit-share viewer']
			] as const) {
				const { client } = await connect(viewerId, ['companions:read']);
				const res: any = await client.callTool({ name: 'roamarr_companion_list', arguments: { tripId: trip.id } });
				expect(res.isError, label).toBeFalsy();
				const row = JSON.parse(res.content[0].text).items.find((r: any) => r.id === companion.id);
				expect(row).toBeTruthy();
				expect(row.dietary).toBe('vegan marker');
				expect(row.allergies).toBe('penicillin allergy');
				expect(row.medicalNotes).toBe('medical notes marker');
				expect(row.needsCarSeat).toBe(true);
				expect(row.needsStroller).toBe(true);
				expect(row.needsCrib).toBe(true);
				expect(row.needsKidsMeal).toBe(true);
				expect(row.childTicketDiscount).toBe('child ticket discount marker');
				expect(row.seatPreference).toBe('seat preference marker');
				expect(row.bedPreference).toBe('bed preference marker');
				expect(row.accessibilityNeeds).toBe('accessibility needs marker');
				expect(row.roomNotes).toBe('room notes marker');
				expect(row.notes).toBe('private notes marker');
			}
		});

		test('read-only share viewer is rejected for editor-only private-module tools', async () => {
			const { ownerId, otherId, trip } = setupSharedTrip('read');
			const { addMedication } = await import('./tripMedications');
			const { addImportantItem } = await import('./tripImportantItems');
			const { addEntryRequirement } = await import('./tripEntryRequirements');
			addMedication(ownerId, trip.id, { name: 'Medicine', notes: 'take with food' });
			addImportantItem(ownerId, trip.id, { name: 'Camera', serialNumber: 'SN-7731' });
			addEntryRequirement(ownerId, trip.id, { country: 'JP', requirementType: 'visa', notes: 'gate code 4451' });
			const { client } = await connect(otherId, ['medications:read', 'items:read', 'requirements:read']);
			for (const name of ['roamarr_medication_list', 'roamarr_important_item_list', 'roamarr_entry_requirement_list']) {
				const res: any = await client.callTool({ name, arguments: { tripId: trip.id } });
				expect(res.isError, name).toBe(true);
				const text = String(res.content?.[0]?.text ?? '');
				expect(text).toMatch(/404|not found/i);
				for (const marker of ['take with food', 'SN-7731', 'gate code 4451']) {
					expect(text).not.toContain(marker);
				}
			}
		});

		test('owner and edit-share viewer get the full private-module lists', async () => {
			const { ownerId, otherId, trip } = setupSharedTrip('edit');
			const { addMedication } = await import('./tripMedications');
			const { addImportantItem } = await import('./tripImportantItems');
			const { addEntryRequirement } = await import('./tripEntryRequirements');
			addMedication(ownerId, trip.id, { name: 'Medicine', notes: 'take with food' });
			addImportantItem(ownerId, trip.id, { name: 'Camera', serialNumber: 'SN-7731' });
			addEntryRequirement(ownerId, trip.id, { country: 'JP', requirementType: 'visa', notes: 'gate code 4451' });
			for (const [viewerId, label] of [
				[ownerId, 'owner'],
				[otherId, 'edit-share viewer']
			] as const) {
				const { client } = await connect(viewerId, ['medications:read', 'items:read', 'requirements:read']);
				const meds: any = await client.callTool({ name: 'roamarr_medication_list', arguments: { tripId: trip.id } });
				expect(meds.isError, label).toBeFalsy();
				expect(JSON.parse(meds.content[0].text).items[0].notes).toBe('take with food');
				const items: any = await client.callTool({ name: 'roamarr_important_item_list', arguments: { tripId: trip.id } });
				expect(items.isError, label).toBeFalsy();
				expect(JSON.parse(items.content[0].text).items[0].serialNumber).toBe('SN-7731');
				const reqs: any = await client.callTool({ name: 'roamarr_entry_requirement_list', arguments: { tripId: trip.id } });
				expect(reqs.isError, label).toBeFalsy();
				expect(JSON.parse(reqs.content[0].text).items[0].notes).toBe('gate code 4451');
			}
		});

		test('unrelated user is rejected for all four private-module tools', async () => {
			const { ownerId, trip } = setupSharedTrip('read');
			const { insertTripCompanion } = await import('./tripCompanions');
			const { addMedication } = await import('./tripMedications');
			const { addImportantItem } = await import('./tripImportantItems');
			const { addEntryRequirement } = await import('./tripEntryRequirements');
			insertTripCompanion(ownerId, trip.id, { name: 'Sam', allergies: 'penicillin allergy' });
			addMedication(ownerId, trip.id, { name: 'Medicine', notes: 'take with food' });
			addImportantItem(ownerId, trip.id, { name: 'Camera', serialNumber: 'SN-7731' });
			addEntryRequirement(ownerId, trip.id, { country: 'JP', requirementType: 'visa', notes: 'gate code 4451' });
			const strangerId = makeUser(ctx.kit).id;
			const { client } = await connect(strangerId, ['companions:read', 'medications:read', 'items:read', 'requirements:read']);
			for (const name of ['roamarr_companion_list', 'roamarr_medication_list', 'roamarr_important_item_list', 'roamarr_entry_requirement_list']) {
				const res: any = await client.callTool({ name, arguments: { tripId: trip.id } });
				expect(res.isError, name).toBe(true);
				const text = String(res.content?.[0]?.text ?? '');
				expect(text).toMatch(/404|not found/i);
				for (const marker of ['penicillin allergy', 'take with food', 'SN-7731', 'gate code 4451']) {
					expect(text).not.toContain(marker);
				}
			}
		});
	});

	describe('prompts', () => {
		test('prompts/list declares tripId argument where required', async () => {
			const { client } = await connect(userId, ['trips:read']);
			const { prompts } = await client.listPrompts();
			const byName = new Map(prompts.map((p) => [p.name, p]));
			expect(byName.size).toBeGreaterThan(0);

			const summary = byName.get('trip-summary');
			expect(summary?.description).toBeTruthy();
			expect(summary?.arguments ?? []).toEqual([]);

			const details = byName.get('trip-details');
			const argNames = (details?.arguments ?? []).map((a) => a.name);
			expect(argNames).toContain('tripId');
			const tripIdArg = details?.arguments?.find((a) => a.name === 'tripId');
			expect(tripIdArg?.required).toBe(true);
		});

		test('prompts/get on trip-summary lists upcoming trips', async () => {
			tripsRepo.createTrip(userId, {
				name: 'Mars Trip',
				startDate: '2099-01-01',
				endDate: '2099-01-08'
			});
			const { client } = await connect(userId, ['trips:read']);
			const res = await readPrompt(client, 'trip-summary');
			const text = promptText(res);
			expect(text).toContain('Mars Trip');
		});

		test('prompts/get enforces the declared scope', async () => {
			const { client } = await connect(userId, ['places:write']);
			const res = await readPrompt(client, 'trip-summary');
			expect(promptText(res)).toContain('Missing required scope: trips:read');
		});

		test('prompts/get requires tripId argument when declared', async () => {
			const { client } = await connect(userId, ['trips:read']);
			const res = await readPrompt(client, 'trip-details');
			expect(promptText(res)).toContain('tripId argument required');
		});

		test('prompts/get returns trip details for an owned trip', async () => {
			const trip = tripsRepo.createTrip(userId, { name: 'Galway', destination: 'Galway' });
			const { client } = await connect(userId, ['trips:read']);
			const res = await readPrompt(client, 'trip-details', { tripId: String(trip.id) });
			const text = promptText(res);
			expect(text).toContain('Galway');
		});

		test('prompts/get on flight-info returns only flight segments', async () => {
			const trip = tripsRepo.createTrip(userId, { name: 'NYC' });
			const { createSegment } = await import('./repositories/segmentsRepo');
			createSegment({
				trip_id: BigInt(trip.id),
				type: 'flight',
				title: 'JFK flight',
				start_at: '2026-08-01T08:00:00Z'
			} as any);
			createSegment({
				trip_id: BigInt(trip.id),
				type: 'hotel',
				title: 'Hotel',
				start_at: '2026-08-01T15:00:00Z'
			} as any);

			const { client } = await connect(userId, ['trips:read']);
			const res = await readPrompt(client, 'flight-info', { tripId: String(trip.id) });
			const text = promptText(res);
			expect(text).toContain('JFK flight');
			expect(text).not.toContain('Hotel');
		});

		test('prompts/get on budget-overview returns the budget categories', async () => {
			const trip = tripsRepo.createTrip(userId, { name: 'Tokyo' });
			const { setBudget } = await import('./tripBudgets');
			setBudget(trip.id, 'lodging', 1000, 'USD');

			const { client } = await connect(userId, ['budgets:read']);
			const res = await readPrompt(client, 'budget-overview', { tripId: String(trip.id) });
			const text = promptText(res);
			expect(text).toContain('lodging');
		});

		test('prompts/get returns "Unknown prompt" for an undeclared name', async () => {
			const { client } = await connect(userId, ['trips:read']);
			const res = await readPrompt(client, 'no-such-prompt');
			expect(promptText(res)).toContain('Unknown prompt');
		});

		test('prompts/get IDOR: cannot read another user\'s trip via trip-details', async () => {
			const other = makeUser(ctx.kit).id;
			const otherTrip = tripsRepo.createTrip(other, { name: 'Private' });
			const { client } = await connect(userId, ['trips:read']);
			const res = await readPrompt(client, 'trip-details', { tripId: String(otherTrip.id) });
			const text = promptText(res);
			expect(text).toContain('Trip not found or inaccessible');
			expect(text).not.toContain('Private');
		});
	});

	describe('resources', () => {
		test('resources/templates/list advertises the trip URI template', async () => {
			const { client } = await connect(userId, ['trips:read']);
			const res = await client.listResourceTemplates();
			const uris = res.resourceTemplates.map((r) => r.uriTemplate);
			expect(uris).toContain('trip://{tripId}');
		});

		test('resources/templates/list is empty without trips:read', async () => {
			const { client } = await connect(userId, ['places:read']);
			const res = await client.listResourceTemplates();
			expect(res.resourceTemplates).toEqual([]);
		});

		test('resources/list enumerates the user\'s viewable trips', async () => {
			tripsRepo.createTrip(userId, { name: 'Public Trip', destination: 'Rome' });
			const archived = tripsRepo.createTrip(userId, { name: 'Archived Trip', destination: 'Old' });
			tripsRepo.updateTrip(archived.id, { archived: true });

			const { client } = await connect(userId, ['trips:read']);
			const res = await client.listResources();
			const names = res.resources.map((r) => r.name);
			expect(names).toContain('Public Trip');
			expect(names).not.toContain('Archived Trip');
			for (const r of res.resources) {
				expect(r.uri).toMatch(/^trip:\/\/\d+$/);
				expect(r.mimeType).toBe('application/json');
			}
		});

		test('resources/list is empty without trips:read', async () => {
			tripsRepo.createTrip(userId, { name: 'Hidden' });
			const { client } = await connect(userId, ['places:read']);
			const res = await client.listResources();
			expect(res.resources).toEqual([]);
		});

		test('resources/list does not enumerate other users\' trips', async () => {
			const other = makeUser(ctx.kit).id;
			tripsRepo.createTrip(other, { name: 'Someone Else' });
			const { client } = await connect(userId, ['trips:read']);
			const res = await client.listResources();
			expect(res.resources.map((r) => r.name)).not.toContain('Someone Else');
		});

		test('resources/read returns trip JSON for an owned trip', async () => {
			const trip = tripsRepo.createTrip(userId, { name: 'Readable', destination: 'Berlin' });
			const { client } = await connect(userId, ['trips:read']);
			const res = await client.readResource({ uri: `trip://${trip.id}` });
			const text = resourceText(res);
			expect(text).toContain('Readable');
		});

		test('resources/read IDOR: another user\'s trip is rejected', async () => {
			const other = makeUser(ctx.kit).id;
			const otherTrip = tripsRepo.createTrip(other, { name: 'No Leak' });
			const { client } = await connect(userId, ['trips:read']);
			await expect(client.readResource({ uri: `trip://${otherTrip.id}` })).rejects.toThrow();
		});

		test('resources/read rejects unknown URI schemes', async () => {
			const { client } = await connect(userId, ['trips:read']);
			await expect(client.readResource({ uri: 'http://example.com/x' })).rejects.toThrow();
		});
	});

	describe('resources/read fare-watch://', () => {
		async function makeOwnedWatch() {
			const ownerId = makeUser(ctx.kit).id;
			const trip = tripsRepo.createTrip(ownerId, { name: 'Fare trip' });
			const { createProvider, toggleWatch } = await import('./fareproviders');
			const provider = createProvider(ownerId, 'stub', 'Work', 'SECRET-KEY', true);
			const watch = toggleWatch(ownerId, trip.id, provider.id);
			return { ownerId, trip, watch };
		}

		test('read-only viewer (showDetails: false) is rejected', async () => {
			const { trip, watch } = await makeOwnedWatch();
			const viewerId = makeUser(ctx.kit).id;
			tripsRepo.createShare({ tripId: trip.id, sharedWithUserId: viewerId, permission: 'read', showDetails: false });
			const { client } = await connect(viewerId, ['fares:read']);
			await expect(client.readResource({ uri: `fare-watch://${watch.id}` })).rejects.toThrow();
		});

		test('read-only viewer with showDetails: true is still rejected', async () => {
			const { trip, watch } = await makeOwnedWatch();
			const viewerId = makeUser(ctx.kit).id;
			tripsRepo.createShare({ tripId: trip.id, sharedWithUserId: viewerId, permission: 'read', showDetails: true });
			const { client } = await connect(viewerId, ['fares:read']);
			await expect(client.readResource({ uri: `fare-watch://${watch.id}` })).rejects.toThrow();
		});

		test('editor is rejected', async () => {
			const { trip, watch } = await makeOwnedWatch();
			const editorId = makeUser(ctx.kit).id;
			tripsRepo.createShare({ tripId: trip.id, sharedWithUserId: editorId, permission: 'edit' });
			const { client } = await connect(editorId, ['fares:read']);
			await expect(client.readResource({ uri: `fare-watch://${watch.id}` })).rejects.toThrow();
		});

		test('unrelated user is rejected', async () => {
			const { watch } = await makeOwnedWatch();
			const strangerId = makeUser(ctx.kit).id;
			const { client } = await connect(strangerId, ['fares:read']);
			await expect(client.readResource({ uri: `fare-watch://${watch.id}` })).rejects.toThrow();
		});

		test('owner without fares:read scope is rejected', async () => {
			const { ownerId, watch } = await makeOwnedWatch();
			const { client } = await connect(ownerId, ['trips:read']);
			await expect(client.readResource({ uri: `fare-watch://${watch.id}` })).rejects.toThrow();
		});

		test('non-existent id throws Fare watch not found', async () => {
			const { client } = await connect(userId, ['fares:read']);
			await expect(client.readResource({ uri: 'fare-watch://999999999' })).rejects.toThrow('Fare watch not found');
		});

		test('owner with fares:read reads the watch', async () => {
			const { ownerId, trip, watch } = await makeOwnedWatch();
			const { client } = await connect(ownerId, ['fares:read']);
			const res = await client.readResource({ uri: `fare-watch://${watch.id}` });
			const text = resourceText(res);
			const parsed = JSON.parse(text);
			expect(parsed.fareWatch.id).toBe(watch.id);
			expect(parsed.fareWatch.tripId).toBe(trip.id);
			expect(parsed.fareWatch).toHaveProperty('lastResultJson');
		});
	});

	describe('saved places tools', () => {
		beforeEach(() => {
			ctx.kit.deleteFrom(placeLinks).executeSync();
			ctx.kit.deleteFrom(places).executeSync();
			ctx.kit.deleteFrom(placeCategories).executeSync();
		});

		test('lists the saved places tools', async () => {
			const { client } = await connect(userId, ['saved-places:read']);
			const { tools } = await client.listTools();
			const names = tools.map((t) => t.name);
			expect(names).toContain('roamarr_saved_places_list');
			expect(names).toContain('roamarr_place_category_create');
			expect(names).toContain('roamarr_saved_places_search');
		});

		test('write tools require saved-places:write', async () => {
			const { client } = await connect(userId, ['saved-places:read']);
			const res: any = await client.callTool({
				name: 'roamarr_saved_places_create',
				arguments: { name: 'Nope' }
			});
			expect(res.isError).toBe(true);
			expect(res.content[0].text).toContain('saved-places:write');
		});

		test('read tools require saved-places:read', async () => {
			const { client } = await connect(userId, ['saved-places:write']);
			const res: any = await client.callTool({ name: 'roamarr_saved_places_list', arguments: {} });
			expect(res.isError).toBe(true);
			expect(res.content[0].text).toContain('saved-places:read');
		});

		test('category and place round-trip with partial update semantics', async () => {
			const { client } = await connect(userId, ['saved-places:read', 'saved-places:write']);
			const call = async (name: string, args: Record<string, unknown>) => {
				const res: any = await client.callTool({ name, arguments: args });
				expect(res.isError).not.toBe(true);
				return JSON.parse(res.content[0].text);
			};

			// Defaults are seeded lazily on first category list.
			const seeded = await call('roamarr_place_category_list', {});
			expect(seeded.items.length).toBe(8);

			const category = await call('roamarr_place_category_create', {
				name: 'Coffee',
				color: '#6f4e37'
			});
			const place = await call('roamarr_saved_places_create', {
				name: 'Cafe Central',
				categoryId: category.id,
				address: 'Herrengasse 14, Vienna',
				priceCents: 450
			});
			expect(place.id).toBeGreaterThan(0);

			// Partial update renames without wiping address/price/category.
			const updated = await call('roamarr_saved_places_update', {
				placeId: place.id,
				name: 'Café Central'
			});
			expect(updated.name).toBe('Café Central');
			expect(updated.address).toBe('Herrengasse 14, Vienna');
			expect(updated.priceCents).toBe(450);
			expect(updated.categoryId).toBe(category.id);

			const got = await call('roamarr_saved_places_get', { placeId: place.id });
			expect(got.status).toBe('planned');

			const visited = await call('roamarr_saved_places_mark_visited', { placeId: place.id });
			expect(visited.status).toBe('visited');
			expect(visited.visitedAt).toBeTruthy();
			const planned = await call('roamarr_saved_places_unmark_visited', { placeId: place.id });
			expect(planned.status).toBe('planned');
			expect(planned.visitedAt).toBeNull();

			// Delete requires confirm: true.
			const denied: any = await client.callTool({
				name: 'roamarr_saved_places_delete',
				arguments: { placeId: place.id }
			});
			expect(denied.isError).toBe(true);
			expect(denied.content[0].text).toContain('confirm');
			const deleted = await call('roamarr_saved_places_delete', { placeId: place.id, confirm: true });
			expect(deleted.ok).toBe(true);

			// Category delete unlinks but keeps places; also requires confirm.
			const catDenied: any = await client.callTool({
				name: 'roamarr_place_category_delete',
				arguments: { categoryId: category.id }
			});
			expect(catDenied.isError).toBe(true);
			const catDeleted = await call('roamarr_place_category_delete', {
				categoryId: category.id,
				confirm: true
			});
			expect(catDeleted.ok).toBe(true);
		});

		test('place category update recolors without renaming', async () => {
			const { client } = await connect(userId, ['saved-places:write']);
			const call = async (name: string, args: Record<string, unknown>) => {
				const res: any = await client.callTool({ name, arguments: args });
				expect(res.isError).not.toBe(true);
				return JSON.parse(res.content[0].text);
			};

			const category = await call('roamarr_place_category_create', { name: 'Museums', color: '#2f9e44' });
			const updated = await call('roamarr_place_category_update', {
				categoryId: category.id,
				color: '#e64980'
			});
			expect(updated.name).toBe('Museums');
			expect(updated.color).toBe('#e64980');
		});

		test('place category update renames without recoloring', async () => {
			const { client } = await connect(userId, ['saved-places:write']);
			const call = async (name: string, args: Record<string, unknown>) => {
				const res: any = await client.callTool({ name, arguments: args });
				expect(res.isError).not.toBe(true);
				return JSON.parse(res.content[0].text);
			};

			const category = await call('roamarr_place_category_create', { name: 'Museums', color: '#2f9e44' });
			const updated = await call('roamarr_place_category_update', {
				categoryId: category.id,
				name: 'Galleries'
			});
			expect(updated.name).toBe('Galleries');
			expect(updated.color).toBe('#2f9e44');
		});

		test('place category update rejects an explicit blank name and leaves the row unchanged', async () => {
			const { client } = await connect(userId, ['saved-places:write']);
			const created: any = await client.callTool({
				name: 'roamarr_place_category_create',
				arguments: { name: 'Museums', color: '#2f9e44' }
			});
			const category = JSON.parse(created.content[0].text);
			const before = ctx.kit.selectFrom(placeCategories).where(kitEq(placeCategories.id, BigInt(category.id))).executeSync()[0];

			const res: any = await client.callTool({
				name: 'roamarr_place_category_update',
				arguments: { categoryId: category.id, name: '   ' }
			});
			expect(res.isError).toBe(true);
			expect(res.content[0].text).toContain('Category name is required');

			const after = ctx.kit.selectFrom(placeCategories).where(kitEq(placeCategories.id, BigInt(category.id))).executeSync()[0];
			expect(after).toEqual(before);
		});

		test('place category update rejects a non-hex color and leaves the row unchanged', async () => {
			const { client } = await connect(userId, ['saved-places:write']);
			const created: any = await client.callTool({
				name: 'roamarr_place_category_create',
				arguments: { name: 'Museums', color: '#2f9e44' }
			});
			const category = JSON.parse(created.content[0].text);
			const before = ctx.kit.selectFrom(placeCategories).where(kitEq(placeCategories.id, BigInt(category.id))).executeSync()[0];

			const res: any = await client.callTool({
				name: 'roamarr_place_category_update',
				arguments: { categoryId: category.id, color: 'red' }
			});
			expect(res.isError).toBe(true);
			expect(res.content[0].text).toContain('Category color must be a hex color like #2f9e44');

			const after = ctx.kit.selectFrom(placeCategories).where(kitEq(placeCategories.id, BigInt(category.id))).executeSync()[0];
			expect(after).toEqual(before);
		});

		test('place category update rejects non-string name and color without changing the row', async () => {
			const { client } = await connect(userId, ['saved-places:write']);
			const created: any = await client.callTool({
				name: 'roamarr_place_category_create',
				arguments: { name: 'Museums', color: '#2f9e44' }
			});
			const category = JSON.parse(created.content[0].text);
			const before = ctx.kit.selectFrom(placeCategories).where(kitEq(placeCategories.id, BigInt(category.id))).executeSync()[0];

			const badName: any = await client.callTool({
				name: 'roamarr_place_category_update',
				arguments: { categoryId: category.id, name: 42 }
			});
			expect(badName.isError).toBe(true);
			expect(badName.content[0].text).toContain('name must be a string');

			const badColor: any = await client.callTool({
				name: 'roamarr_place_category_update',
				arguments: { categoryId: category.id, color: 255 }
			});
			expect(badColor.isError).toBe(true);
			expect(badColor.content[0].text).toContain('color must be a string');

			const after = ctx.kit.selectFrom(placeCategories).where(kitEq(placeCategories.id, BigInt(category.id))).executeSync()[0];
			expect(after).toEqual(before);
		});

		test('place category create rejects non-string name and color without inserting a row', async () => {
			const { client } = await connect(userId, ['saved-places:write']);
			const before = ctx.kit.selectFrom(placeCategories).executeSync().length;

			const badName: any = await client.callTool({
				name: 'roamarr_place_category_create',
				arguments: { name: {} }
			});
			expect(badName.isError).toBe(true);
			expect(badName.content[0].text).toContain('name must be a string');

			const badColor: any = await client.callTool({
				name: 'roamarr_place_category_create',
				arguments: { name: 'Museums', color: 255 }
			});
			expect(badColor.isError).toBe(true);
			expect(badColor.content[0].text).toContain('color must be a string');

			const after = ctx.kit.selectFrom(placeCategories).executeSync().length;
			expect(after).toBe(before);
		});

		test('place category update rejects another user\'s category with no update', async () => {
			const other = makeUser(ctx.kit).id;
			const { client: otherClient } = await connect(other, ['saved-places:write']);
			const created: any = await otherClient.callTool({
				name: 'roamarr_place_category_create',
				arguments: { name: 'Other', color: '#2f9e44' }
			});
			const categoryId = JSON.parse(created.content[0].text).id;

			const { client } = await connect(userId, ['saved-places:write']);
			const res: any = await client.callTool({
				name: 'roamarr_place_category_update',
				arguments: { categoryId, name: 'Hijack' }
			});
			expect(res.isError).toBe(true);
			expect(res.content[0].text).toContain('Category not found');

			const row = ctx.kit.selectFrom(placeCategories).where(kitEq(placeCategories.id, BigInt(categoryId))).executeSync()[0];
			expect(row.name).toBe('Other');
			expect(row.color).toBe('#2f9e44');
		});

		test('place category update schema requires only categoryId', async () => {
			const { client } = await connect(userId, ['saved-places:read']);
			const { tools } = await client.listTools();
			const update = tools.find((t) => t.name === 'roamarr_place_category_update');
			expect(update?.inputSchema.required).toEqual(['categoryId']);
			expect(tools).toHaveLength(144);
		});

		test('places IDOR: another user\'s place is not visible or mutable', async () => {
			const other = makeUser(ctx.kit).id;
			const { client: otherClient } = await connect(other, ['saved-places:write']);
			const created: any = await otherClient.callTool({
				name: 'roamarr_saved_places_create',
				arguments: { name: 'Other place' }
			});
			const placeId = JSON.parse(created.content[0].text).id;

			const { client } = await connect(userId, ['saved-places:read', 'saved-places:write']);
			const got: any = await client.callTool({
				name: 'roamarr_saved_places_get',
				arguments: { placeId }
			});
			expect(got.isError).toBe(true);
			const deleted: any = await client.callTool({
				name: 'roamarr_saved_places_delete',
				arguments: { placeId, confirm: true }
			});
			expect(deleted.isError).toBe(true);
		});

		test('saved_places_search degrades gracefully when Nominatim is unreachable', async () => {
			vi.stubGlobal('fetch', async () => {
				throw new TypeError('fetch failed');
			});
			try {
				const { client } = await connect(userId, ['saved-places:read']);
				const res: any = await client.callTool({
					name: 'roamarr_saved_places_search',
					arguments: { query: 'eiffel tower' }
				});
				expect(res.isError).toBe(true);
				expect(res.content[0].text).toContain('unavailable');
			} finally {
				vi.unstubAllGlobals();
			}
		});

		test('saved_places_import requires the write scope and confirm', async () => {
			const { client: reader } = await connect(userId, ['saved-places:read']);
			const scopeDenied: any = await reader.callTool({
				name: 'roamarr_saved_places_import',
				arguments: { rows: [{ name: 'X' }], confirm: true }
			});
			expect(scopeDenied.isError).toBe(true);
			expect(scopeDenied.content[0].text).toContain('saved-places:write');

			const { client } = await connect(userId, ['saved-places:write']);
			const confirmDenied: any = await client.callTool({
				name: 'roamarr_saved_places_import',
				arguments: { rows: [{ name: 'X' }] }
			});
			expect(confirmDenied.isError).toBe(true);
			expect(confirmDenied.content[0].text).toContain('confirm');
		});

		test('saved_places_import creates rows and skips duplicates', async () => {
			const { client } = await connect(userId, ['saved-places:write']);
			await client.callTool({
				name: 'roamarr_saved_places_create',
				arguments: { name: 'Existing', lat: 48.8583, lng: 2.2945 }
			});

			const res: any = await client.callTool({
				name: 'roamarr_saved_places_import',
				arguments: {
					rows: [
						{ name: 'Existing', lat: null, lng: null },
						{ name: 'Near Existing', lat: 48.85831, lng: 2.29451 },
						{ name: 'Brand New', lat: 40.4168, lng: -3.7038, address: 'Madrid' }
					],
					confirm: true
				}
			});
			expect(res.isError).not.toBe(true);
			const result = JSON.parse(res.content[0].text);
			expect(result.created).toBe(1);
			expect(result.skippedDuplicates).toBe(2);
			expect(result.errors).toHaveLength(0);

			// skipDuplicates: false imports everything.
			const res2: any = await client.callTool({
				name: 'roamarr_saved_places_import',
				arguments: {
					rows: [{ name: 'Existing', lat: 1, lng: 1 }],
					skipDuplicates: false,
					confirm: true
				}
			});
			const result2 = JSON.parse(res2.content[0].text);
			expect(result2.created).toBe(1);
			expect(result2.skippedDuplicates).toBe(0);
		});

		test('saved_places_import validates the rows payload', async () => {
			const { client } = await connect(userId, ['saved-places:write']);
			const noRows: any = await client.callTool({
				name: 'roamarr_saved_places_import',
				arguments: { confirm: true }
			});
			expect(noRows.isError).toBe(true);
			expect(noRows.content[0].text).toContain('rows must be an array');

			const nameless: any = await client.callTool({
				name: 'roamarr_saved_places_import',
				arguments: { rows: [{ lat: 1, lng: 2 }], confirm: true }
			});
			expect(nameless.isError).toBe(true);
			expect(nameless.content[0].text).toContain('name');
		});
	});

	describe('place links tools', () => {
		beforeEach(() => {
			ctx.kit.deleteFrom(placeLinks).executeSync();
			ctx.kit.deleteFrom(places).executeSync();
		});

		async function seedPlace(client: Client) {
			const res: any = await client.callTool({
				name: 'roamarr_saved_places_create',
				arguments: { name: 'Linkable place' }
			});
			return JSON.parse(res.content[0].text).id as number;
		}

		test('lists the place links tools', async () => {
			const { client } = await connect(userId, ['saved-places:read']);
			const { tools } = await client.listTools();
			const names = tools.map((t) => t.name);
			expect(names).toContain('roamarr_place_links_list');
			expect(names).toContain('roamarr_place_links_create');
			expect(names).toContain('roamarr_place_links_update');
			expect(names).toContain('roamarr_place_links_delete');
		});

		test('place links ride on the saved-places scopes', async () => {
			const { client: reader } = await connect(userId, ['saved-places:read']);
			const writeDenied: any = await reader.callTool({
				name: 'roamarr_place_links_create',
				arguments: { placeId: 1, label: 'X', url: 'https://a.example' }
			});
			expect(writeDenied.isError).toBe(true);
			expect(writeDenied.content[0].text).toContain('saved-places:write');

			const { client: writer } = await connect(userId, ['saved-places:write']);
			const readDenied: any = await writer.callTool({
				name: 'roamarr_place_links_list',
				arguments: { placeId: 1 }
			});
			expect(readDenied.isError).toBe(true);
			expect(readDenied.content[0].text).toContain('saved-places:read');
		});

		test('place links round-trip with partial update and confirm-gated delete', async () => {
			const { client } = await connect(userId, ['saved-places:read', 'saved-places:write']);
			const call = async (name: string, args: Record<string, unknown>) => {
				const res: any = await client.callTool({ name, arguments: args });
				expect(res.isError, res.content?.[0]?.text).not.toBe(true);
				return JSON.parse(res.content[0].text);
			};
			const placeId = await seedPlace(client);

			const created = await call('roamarr_place_links_create', {
				placeId,
				label: 'Official site',
				url: 'https://cafe.example',
				notes: 'Menu PDF'
			});
			expect(created.id).toBeGreaterThan(0);

			// Non-http(s) URLs are rejected.
			const badUrl: any = await client.callTool({
				name: 'roamarr_place_links_create',
				arguments: { placeId, label: 'X', url: 'javascript:alert(1)' }
			});
			expect(badUrl.isError).toBe(true);

			// Partial update renames without wiping url/notes.
			await call('roamarr_place_links_update', { linkId: created.id, label: 'Website' });
			const listed = await call('roamarr_place_links_list', { placeId });
			expect(listed.items).toHaveLength(1);
			expect(listed.items[0].label).toBe('Website');
			expect(listed.items[0].url).toBe('https://cafe.example');
			expect(listed.items[0].notes).toBe('Menu PDF');

			// Delete requires confirm: true.
			const denied: any = await client.callTool({
				name: 'roamarr_place_links_delete',
				arguments: { linkId: created.id }
			});
			expect(denied.isError).toBe(true);
			expect(denied.content[0].text).toContain('confirm');
			const deleted = await call('roamarr_place_links_delete', { linkId: created.id, confirm: true });
			expect(deleted.ok).toBe(true);
			expect((await call('roamarr_place_links_list', { placeId })).items).toHaveLength(0);
		});

		test('place links update rejects a malformed linkId', async () => {
			const { client } = await connect(userId, ['saved-places:read', 'saved-places:write']);
			const call = async (name: string, args: Record<string, unknown>) => {
				const res: any = await client.callTool({ name, arguments: args });
				expect(res.isError, res.content?.[0]?.text).not.toBe(true);
				return JSON.parse(res.content[0].text);
			};
			const placeId = await seedPlace(client);
			await call('roamarr_place_links_create', {
				placeId,
				label: 'Official site',
				url: 'https://cafe.example',
				notes: 'Menu PDF'
			});

			const malformed: Array<Record<string, unknown>> = [
				{ label: 'x' },
				{ linkId: 'abc', label: 'x' },
				{ linkId: 1.5, label: 'x' },
				{ linkId: 0, label: 'x' },
				{ linkId: null, label: 'x' }
			];
			for (const args of malformed) {
				const res: any = await client.callTool({
					name: 'roamarr_place_links_update',
					arguments: args
				});
				expect(res.isError).toBe(true);
				expect(String(res.content?.[0]?.text ?? '')).toContain('linkId must be a positive integer');
			}

			const listed = await call('roamarr_place_links_list', { placeId });
			expect(listed.items).toHaveLength(1);
			expect(listed.items[0].label).toBe('Official site');
		});

		test('place links update rejects non-string fields instead of stringifying them', async () => {
			const { client } = await connect(userId, ['saved-places:read', 'saved-places:write']);
			const call = async (name: string, args: Record<string, unknown>) => {
				const res: any = await client.callTool({ name, arguments: args });
				expect(res.isError, res.content?.[0]?.text).not.toBe(true);
				return JSON.parse(res.content[0].text);
			};
			const placeId = await seedPlace(client);
			const created = await call('roamarr_place_links_create', {
				placeId,
				label: 'Official site',
				url: 'https://cafe.example',
				notes: 'Menu PDF'
			});

			const bad: Array<Record<string, unknown>> = [
				{ linkId: created.id, label: null },
				{ linkId: created.id, label: 42 },
				{ linkId: created.id, label: {} },
				{ linkId: created.id, url: null },
				{ linkId: created.id, url: ['https://evil.example'] },
				{ linkId: created.id, notes: 42 },
				{ linkId: created.id, notes: ['a', 'b'] }
			];
			for (const args of bad) {
				const res: any = await client.callTool({
					name: 'roamarr_place_links_update',
					arguments: args
				});
				expect(res.isError).toBe(true);
				expect(String(res.content?.[0]?.text ?? '')).toContain('must be a string');
			}

			const listed = await call('roamarr_place_links_list', { placeId });
			expect(listed.items).toHaveLength(1);
			expect(listed.items[0].label).toBe('Official site');
			expect(listed.items[0].url).toBe('https://cafe.example');
			expect(listed.items[0].notes).toBe('Menu PDF');
		});

		test('place links update with no fields is a no-op without an audit row', async () => {
			const { client } = await connect(userId, ['saved-places:read', 'saved-places:write']);
			const call = async (name: string, args: Record<string, unknown>) => {
				const res: any = await client.callTool({ name, arguments: args });
				expect(res.isError, res.content?.[0]?.text).not.toBe(true);
				return JSON.parse(res.content[0].text);
			};
			const placeId = await seedPlace(client);
			const created = await call('roamarr_place_links_create', {
				placeId,
				label: 'Official site',
				url: 'https://cafe.example',
				notes: 'Menu PDF'
			});
			const countAudit = () =>
				ctx.kit
					.selectFrom(auditLogs)
					.where(kitEq(auditLogs.user_id, BigInt(userId)))
					.executeSync()
					.filter((r: any) => r.action === 'mcp_place_link_update').length;
			const before = countAudit();

			const res = await call('roamarr_place_links_update', { linkId: created.id });
			expect(res).toEqual({ ok: true, linkId: created.id, updated: false });
			expect(countAudit()).toBe(before);

			const listed = await call('roamarr_place_links_list', { placeId });
			expect(listed.items).toHaveLength(1);
			expect(listed.items[0].label).toBe('Official site');
			expect(listed.items[0].url).toBe('https://cafe.example');
			expect(listed.items[0].notes).toBe('Menu PDF');
		});

		test('place links update clears notes and audits a real write', async () => {
			const { client } = await connect(userId, ['saved-places:read', 'saved-places:write']);
			const call = async (name: string, args: Record<string, unknown>) => {
				const res: any = await client.callTool({ name, arguments: args });
				expect(res.isError, res.content?.[0]?.text).not.toBe(true);
				return JSON.parse(res.content[0].text);
			};
			const placeId = await seedPlace(client);
			const created = await call('roamarr_place_links_create', {
				placeId,
				label: 'Official site',
				url: 'https://cafe.example',
				notes: 'Menu PDF'
			});
			const countAudit = () =>
				ctx.kit
					.selectFrom(auditLogs)
					.where(kitEq(auditLogs.user_id, BigInt(userId)))
					.executeSync()
					.filter((r: any) => r.action === 'mcp_place_link_update').length;
			const before = countAudit();

			const res = await call('roamarr_place_links_update', { linkId: created.id, notes: null });
			expect(res).toEqual({ ok: true, linkId: created.id, updated: true });
			expect(countAudit()).toBe(before + 1);

			const listed = await call('roamarr_place_links_list', { placeId });
			expect(listed.items).toHaveLength(1);
			expect(listed.items[0].notes).toBe(null);
			expect(listed.items[0].label).toBe('Official site');
			expect(listed.items[0].url).toBe('https://cafe.example');
		});

		test('place links IDOR: another user\'s place is not visible or mutable', async () => {
			const other = makeUser(ctx.kit).id;
			const { client: otherClient } = await connect(other, ['saved-places:read', 'saved-places:write']);
			const placeId = await seedPlace(otherClient);
			const created: any = await otherClient.callTool({
				name: 'roamarr_place_links_create',
				arguments: { placeId, label: 'Secret', url: 'https://secret.example' }
			});
			const linkId = JSON.parse(created.content[0].text).id;

			const { client } = await connect(userId, ['saved-places:read', 'saved-places:write']);
			const listed: any = await client.callTool({
				name: 'roamarr_place_links_list',
				arguments: { placeId }
			});
			expect(listed.isError).toBe(true);
			const updated: any = await client.callTool({
				name: 'roamarr_place_links_update',
				arguments: { linkId, label: 'Hijacked' }
			});
			expect(updated.isError).toBe(true);
			const deleted: any = await client.callTool({
				name: 'roamarr_place_links_delete',
				arguments: { linkId, confirm: true }
			});
			expect(deleted.isError).toBe(true);
		});
	});

	describe('segment update strict input validation', () => {
		async function seedSegment(trip: { id: number }) {
			const { createSegment } = await import('./repositories/segmentsRepo');
			return createSegment({
				trip_id: BigInt(trip.id),
				type: 'event',
				title: 'Museum',
				start_at: '2026-08-01T10:00:00Z',
				start_tz: 'UTC'
			});
		}

		test('segment update rejects a malformed segmentId', async () => {
			const trip = tripsRepo.createTrip(userId, { name: 'Bad id' });
			const seg = await seedSegment(trip);
			const { client } = await connect(userId, ['segments:read', 'segments:write']);

			const malformed: Array<Record<string, unknown>> = [
				{ title: 'x' },
				{ segmentId: 'abc', title: 'x' },
				{ segmentId: 1.5, title: 'x' },
				{ segmentId: 0, title: 'x' },
				{ segmentId: -1, title: 'x' },
				{ segmentId: null, title: 'x' },
				{ segmentId: true, title: 'x' }
			];
			for (const args of malformed) {
				const res: any = await client.callTool({
					name: 'roamarr_segment_update',
					arguments: args
				});
				expect(res.isError, JSON.stringify(args)).toBe(true);
				expect(String(res.content?.[0]?.text ?? '')).toContain('segmentId must be a positive integer');
			}

			const { getSegmentById } = await import('./repositories/segmentsRepo');
			expect(getSegmentById(seg.id)!.title).toBe('Museum');
		});

		test('segment update rejects null and mistyped fields without changing the segment', async () => {
			const trip = tripsRepo.createTrip(userId, { name: 'Strict update' });
			const seg = await seedSegment(trip);
			const { client } = await connect(userId, ['segments:read', 'segments:write']);
			const { getSegmentById } = await import('./repositories/segmentsRepo');
			const before = getSegmentById(seg.id)!;

			const rows: Array<[Record<string, unknown>, string]> = [
				[{ title: null }, 'title cannot be null'],
				[{ title: '   ' }, 'title must be a non-empty string'],
				[{ title: 123 }, 'title must be a non-empty string'],
				[{ type: null }, 'type cannot be null'],
				[{ startAt: null }, 'startAt cannot be null'],
				[{ startTz: null }, 'startTz cannot be null'],
				[{ endTz: null }, 'endTz cannot be null'],
				[{ notes: null }, 'notes cannot be null'],
				[{ paymentStatus: null }, 'paymentStatus cannot be null'],
				[{ details: null }, 'details cannot be null'],
				[{ details: 'abc' }, 'details must be an object'],
				[{ details: [1, 2] }, 'details must be an object'],
				[{ cityLat: '48.85' }, 'cityLat must be a finite number between -90 and 90'],
				[{ cityLat: 91 }, 'cityLat must be a finite number between -90 and 90'],
				[{ cityLat: -91 }, 'cityLat must be a finite number between -90 and 90'],
				[{ cityLng: 200 }, 'cityLng must be a finite number between -180 and 180'],
				[{ cityLng: 'x' }, 'cityLng must be a finite number between -180 and 180'],
				[{ location: 5 }, 'location must be a string'],
				[{ venue: {} }, 'venue must be a string'],
				[{ confirmationNumber: true }, 'confirmationNumber must be a string'],
				[{ cityName: 7 }, 'cityName must be a string'],
				[{ countryCode: 12 }, 'countryCode must be a string'],
				[{ admin1Code: [] }, 'admin1Code must be a string'],
				[{}, 'at least one field to update is required']
			];
			for (const [args, expected] of rows) {
				const res: any = await client.callTool({
					name: 'roamarr_segment_update',
					arguments: { segmentId: seg.id, ...args }
				});
				expect(res.isError, JSON.stringify(args)).toBe(true);
				expect(String(res.content?.[0]?.text ?? '')).toContain(expected);
			}

			const after = getSegmentById(seg.id)!;
			expect(after.title).toBe(before.title);
			expect(after.type).toBe(before.type);
			expect(after.startAt).toBe(before.startAt);
			expect(after.startTz).toBe(before.startTz);
			expect(after.cityLat).toBe(before.cityLat);
			expect(after.cityLng).toBe(before.cityLng);
			expect(after.detailsJson).toBe(before.detailsJson);
			if ('updatedAt' in before) {
				expect(after.updatedAt).toBe(before.updatedAt);
			}
		});

		test('segment update still applies valid partial patches', async () => {
			const trip = tripsRepo.createTrip(userId, { name: 'Valid update' });
			const seg = await seedSegment(trip);
			const { client } = await connect(userId, ['segments:read', 'segments:write']);
			const { getSegmentById } = await import('./repositories/segmentsRepo');
			const before = getSegmentById(seg.id)!;

			const titleRes: any = await client.callTool({
				name: 'roamarr_segment_update',
				arguments: { segmentId: seg.id, title: 'Updated museum' }
			});
			expect(titleRes.isError).toBeFalsy();
			const afterTitle = getSegmentById(seg.id)!;
			expect(afterTitle.title).toBe('Updated museum');
			expect(afterTitle.type).toBe(before.type);
			expect(afterTitle.startAt).toBe(before.startAt);
			expect(afterTitle.detailsJson).toBe(before.detailsJson);

			const notesRes: any = await client.callTool({
				name: 'roamarr_segment_update',
				arguments: { segmentId: seg.id, notes: 'Bring ID' }
			});
			expect(notesRes.isError).toBeFalsy();
			const detailsRes: any = await client.callTool({
				name: 'roamarr_segment_update',
				arguments: { segmentId: seg.id, details: { bookingRef: 'A1' } }
			});
			expect(detailsRes.isError).toBeFalsy();
			const merged = getSegmentById(seg.id)!;
			expect(JSON.parse(merged.detailsJson!)).toMatchObject({ notes: 'Bring ID', bookingRef: 'A1' });

			const coordsRes: any = await client.callTool({
				name: 'roamarr_segment_update',
				arguments: { segmentId: seg.id, cityLat: 48.8566, cityLng: 2.3522 }
			});
			expect(coordsRes.isError).toBeFalsy();
			const coords = getSegmentById(seg.id)!;
			expect(coords.cityLat).toBe(48.8566);
			expect(coords.cityLng).toBe(2.3522);

			const clearRes: any = await client.callTool({
				name: 'roamarr_segment_update',
				arguments: { segmentId: seg.id, cityLat: null, cityLng: null, endAt: null, venue: null }
			});
			expect(clearRes.isError).toBeFalsy();
			const cleared = getSegmentById(seg.id)!;
			expect(cleared.cityLat).toBeNull();
			expect(cleared.cityLng).toBeNull();
			expect(cleared.endAt).toBeNull();
			expect(cleared.venue).toBeNull();

			const paymentStatus = SEGMENT_PAYMENT_STATUSES[2];
			const paymentRes: any = await client.callTool({
				name: 'roamarr_segment_update',
				arguments: { segmentId: seg.id, paymentStatus }
			});
			expect(paymentRes.isError).toBeFalsy();
			expect(getSegmentById(seg.id)!.paymentStatus).toBe(paymentStatus);
		});
	});

	describe('day notes tools', () => {
		const auditRowsFor = (uid: number) =>
			ctx.kit
				.selectFrom(auditLogs)
				.where(kitEq(auditLogs.user_id, BigInt(uid)))
				.executeSync();

		test('lists the day notes tools', async () => {
			const { client } = await connect(userId, ['day-notes:read']);
			const { tools } = await client.listTools();
			const names = tools.map((t) => t.name);
			expect(names).toContain('roamarr_trip_day_notes_list');
			expect(names).toContain('roamarr_trip_day_notes_set');
			expect(names).toContain('roamarr_trip_day_notes_delete');
		});

		test('read tools require day-notes:read', async () => {
			const trip = tripsRepo.createTrip(userId, { name: 'T' });
			const { client } = await connect(userId, ['day-notes:write']);
			const res: any = await client.callTool({
				name: 'roamarr_trip_day_notes_list',
				arguments: { tripId: trip.id }
			});
			expect(res.isError).toBe(true);
			expect(res.content[0].text).toContain('day-notes:read');
		});

		test('write tools require day-notes:write', async () => {
			const trip = tripsRepo.createTrip(userId, { name: 'T' });
			const { client } = await connect(userId, ['day-notes:read']);
			const res: any = await client.callTool({
				name: 'roamarr_trip_day_notes_set',
				arguments: { tripId: trip.id, date: '2026-06-10', body: 'Nope' }
			});
			expect(res.isError).toBe(true);
			expect(res.content[0].text).toContain('day-notes:write');
		});

		test('set, list, and delete round-trip with confirm gate', async () => {
			const trip = tripsRepo.createTrip(userId, { name: 'T' });
			const { client } = await connect(userId, ['day-notes:read', 'day-notes:write']);
			const call = async (name: string, args: Record<string, unknown>) => {
				const res: any = await client.callTool({ name, arguments: args });
				expect(res.isError, res.content?.[0]?.text).toBeFalsy();
				return JSON.parse(res.content[0].text);
			};

			const note = await call('roamarr_trip_day_notes_set', {
				tripId: trip.id,
				date: '2026-06-10',
				icon: 'star',
				body: 'Museum day'
			});
			expect(note.date).toBe('2026-06-10');
			expect(note.icon).toBe('star');

			// Upsert on the same (trip, date) keeps a single note.
			await call('roamarr_trip_day_notes_set', {
				tripId: trip.id,
				date: '2026-06-10',
				body: 'Updated'
			});
			const listed = await call('roamarr_trip_day_notes_list', { tripId: trip.id });
			expect(listed.items).toHaveLength(1);
			expect(listed.items[0].body).toBe('Updated');

			const denied: any = await client.callTool({
				name: 'roamarr_trip_day_notes_delete',
				arguments: { tripId: trip.id, date: '2026-06-10' }
			});
			expect(denied.isError).toBe(true);
			expect(denied.content[0].text).toContain('confirm');

			const deleted = await call('roamarr_trip_day_notes_delete', {
				tripId: trip.id,
				date: '2026-06-10',
				confirm: true
			});
			expect(deleted.ok).toBe(true);
			expect((await call('roamarr_trip_day_notes_list', { tripId: trip.id })).items).toHaveLength(0);
		});

		test("day notes of another user's trip are not visible or mutable", async () => {
			const other = makeUser(ctx.kit).id;
			const trip = tripsRepo.createTrip(other, { name: 'Other trip' });
			const { client } = await connect(userId, ['day-notes:read', 'day-notes:write']);

			const set: any = await client.callTool({
				name: 'roamarr_trip_day_notes_set',
				arguments: { tripId: trip.id, date: '2026-06-10', body: 'Hacked' }
			});
			expect(set.isError).toBe(true);
			const listed: any = await client.callTool({
				name: 'roamarr_trip_day_notes_list',
				arguments: { tripId: trip.id }
			});
			expect(listed.isError).toBe(true);
		});

		test('day_notes_set writes one audit row per write', async () => {
			const trip = tripsRepo.createTrip(userId, { name: 'T' });
			const { client } = await connect(userId, ['day-notes:read', 'day-notes:write']);
			const call = async (name: string, args: Record<string, unknown>) => {
				const res: any = await client.callTool({ name, arguments: args });
				expect(res.isError, res.content?.[0]?.text).toBeFalsy();
				return JSON.parse(res.content[0].text);
			};
			const before = auditRowsFor(userId).length;

			const first = await call('roamarr_trip_day_notes_set', {
				tripId: trip.id,
				date: '2026-07-12',
				body: 'first'
			});
			expect(auditRowsFor(userId)).toHaveLength(before + 1);
			const createRows = auditRowsFor(userId).filter(
				(r: any) => r.entity_id === BigInt(first.id)
			);
			expect(createRows.map((r: any) => r.action)).toEqual(['create']);
			expect(
				auditRowsFor(userId).some((r: any) => r.action === 'mcp_day_note_set')
			).toBe(false);

			await call('roamarr_trip_day_notes_set', {
				tripId: trip.id,
				date: '2026-07-12',
				body: 'second'
			});
			expect(auditRowsFor(userId)).toHaveLength(before + 2);
			const rows = auditRowsFor(userId).filter(
				(r: any) => r.entity_id === BigInt(first.id)
			);
			expect(rows.map((r: any) => r.action)).toEqual(['create', 'update']);
			expect(
				auditRowsFor(userId).some((r: any) => r.action === 'mcp_day_note_set')
			).toBe(false);
		});

		test('day_notes_delete writes one audit row and removes the note', async () => {
			const trip = tripsRepo.createTrip(userId, { name: 'T' });
			const { client } = await connect(userId, ['day-notes:read', 'day-notes:write']);
			const call = async (name: string, args: Record<string, unknown>) => {
				const res: any = await client.callTool({ name, arguments: args });
				expect(res.isError, res.content?.[0]?.text).toBeFalsy();
				return JSON.parse(res.content[0].text);
			};
			const before = auditRowsFor(userId).length;

			const note = await call('roamarr_trip_day_notes_set', {
				tripId: trip.id,
				date: '2026-07-12',
				body: 'first'
			});
			await call('roamarr_trip_day_notes_set', {
				tripId: trip.id,
				date: '2026-07-12',
				body: 'second'
			});

			const res: any = await client.callTool({
				name: 'roamarr_trip_day_notes_delete',
				arguments: { tripId: trip.id, date: '2026-07-12', confirm: true }
			});
			expect(res.isError).toBeFalsy();
			expect(JSON.parse(res.content[0].text)).toEqual({
				ok: true,
				tripId: trip.id,
				date: '2026-07-12'
			});

			const listed = await call('roamarr_trip_day_notes_list', { tripId: trip.id });
			expect(listed.items).toHaveLength(0);
			const rows = auditRowsFor(userId).filter(
				(r: any) => r.entity_id === BigInt(note.id)
			);
			expect(rows.map((r: any) => r.action)).toEqual(['create', 'update', 'delete']);
			expect(auditRowsFor(userId)).toHaveLength(before + 3);
			expect(
				auditRowsFor(userId).some((r: any) => r.action === 'mcp_day_note_delete')
			).toBe(false);
		});

		test('day_notes_delete for a date without a note is an error and writes no audit row', async () => {
			const trip = tripsRepo.createTrip(userId, { name: 'T' });
			const { client } = await connect(userId, ['day-notes:read', 'day-notes:write']);
			const call = async (name: string, args: Record<string, unknown>) => {
				const res: any = await client.callTool({ name, arguments: args });
				expect(res.isError, res.content?.[0]?.text).toBeFalsy();
				return JSON.parse(res.content[0].text);
			};
			await call('roamarr_trip_day_notes_set', {
				tripId: trip.id,
				date: '2026-07-12',
				body: 'first'
			});
			const before = auditRowsFor(userId).length;

			const res: any = await client.callTool({
				name: 'roamarr_trip_day_notes_delete',
				arguments: { tripId: trip.id, date: '2026-07-13', confirm: true }
			});
			expect(res.isError).toBe(true);
			expect(auditRowsFor(userId)).toHaveLength(before);

			const listed = await call('roamarr_trip_day_notes_list', { tripId: trip.id });
			expect(listed.items).toHaveLength(1);
			expect(listed.items[0].date).toBe('2026-07-12');
		});

		test('day_notes_delete without confirm writes nothing', async () => {
			const trip = tripsRepo.createTrip(userId, { name: 'T' });
			const { client } = await connect(userId, ['day-notes:read', 'day-notes:write']);
			const call = async (name: string, args: Record<string, unknown>) => {
				const res: any = await client.callTool({ name, arguments: args });
				expect(res.isError, res.content?.[0]?.text).toBeFalsy();
				return JSON.parse(res.content[0].text);
			};
			await call('roamarr_trip_day_notes_set', {
				tripId: trip.id,
				date: '2026-07-12',
				body: 'first'
			});
			const before = auditRowsFor(userId).length;

			const res: any = await client.callTool({
				name: 'roamarr_trip_day_notes_delete',
				arguments: { tripId: trip.id, date: '2026-07-12' }
			});
			expect(res.isError).toBe(true);
			expect(auditRowsFor(userId)).toHaveLength(before);

			const listed = await call('roamarr_trip_day_notes_list', { tripId: trip.id });
			expect(listed.items).toHaveLength(1);
		});

		test("day_notes_delete on another user's trip is rejected without an audit row", async () => {
			const other = makeUser(ctx.kit).id;
			const trip = tripsRepo.createTrip(userId, { name: 'T' });
			const { client } = await connect(userId, ['day-notes:read', 'day-notes:write']);
			const call = async (name: string, args: Record<string, unknown>) => {
				const res: any = await client.callTool({ name, arguments: args });
				expect(res.isError, res.content?.[0]?.text).toBeFalsy();
				return JSON.parse(res.content[0].text);
			};
			const note = await call('roamarr_trip_day_notes_set', {
				tripId: trip.id,
				date: '2026-07-12',
				body: 'first'
			});
			const otherCount = auditRowsFor(other).length;
			const { client: otherClient } = await connect(other, ['day-notes:read', 'day-notes:write']);
			const res: any = await otherClient.callTool({
				name: 'roamarr_trip_day_notes_delete',
				arguments: { tripId: trip.id, date: '2026-07-12', confirm: true }
			});
			expect(res.isError).toBe(true);

			const listed = await call('roamarr_trip_day_notes_list', { tripId: trip.id });
			expect(listed.items).toHaveLength(1);
			expect(
				auditRowsFor(userId).filter(
					(r: any) => r.entity_id === BigInt(note.id) && r.action === 'delete'
				)
			).toHaveLength(0);
			expect(auditRowsFor(other)).toHaveLength(otherCount);
		});
	});

	describe('gallery tools', () => {
		const GALLERY_PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

		async function withAttachmentsDir<T>(fn: () => Promise<T>): Promise<T> {
			const { mkdtempSync, rmSync } = await import('node:fs');
			const { tmpdir } = await import('node:os');
			const path = await import('node:path');
			const original = process.env.ATTACHMENTS_PATH;
			const dir = mkdtempSync(path.join(tmpdir(), 'roamarr-mcp-gallery-'));
			process.env.ATTACHMENTS_PATH = dir;
			try {
				return await fn();
			} finally {
				if (original === undefined) delete process.env.ATTACHMENTS_PATH;
				else process.env.ATTACHMENTS_PATH = original;
				rmSync(dir, { recursive: true, force: true });
			}
		}

		test('lists the gallery tools', async () => {
			const { client } = await connect(userId, ['gallery:read']);
			const { tools } = await client.listTools();
			const names = tools.map((t) => t.name);
			expect(names).toContain('roamarr_gallery_list');
			expect(names).toContain('roamarr_gallery_remove');
			expect(names).toContain('roamarr_gallery_reorder');
			expect(names).toContain('roamarr_gallery_set_caption');
		});

		test('read tools require gallery:read', async () => {
			const { client } = await connect(userId, ['gallery:write']);
			const res: any = await client.callTool({
				name: 'roamarr_gallery_list',
				arguments: { ownerType: 'trip', ownerId: 1 }
			});
			expect(res.isError).toBe(true);
			expect(res.content[0].text).toContain('gallery:read');
		});

		test('write tools require gallery:write', async () => {
			const { client } = await connect(userId, ['gallery:read']);
			const res: any = await client.callTool({
				name: 'roamarr_gallery_set_caption',
				arguments: { imageId: 1, caption: 'x' }
			});
			expect(res.isError).toBe(true);
			expect(res.content[0].text).toContain('gallery:write');
		});

		test('list, caption, reorder, and remove round-trip with confirm gate', async () => {
			await withAttachmentsDir(async () => {
				const { createPlace } = await import('./places');
				const { addGalleryImages } = await import('./gallery');
				const place = createPlace(userId, { name: 'Overlook' });
				const added = await addGalleryImages(userId, 'place', place.id, [
					new File([GALLERY_PNG], 'a.png', { type: 'image/png' }),
					new File([GALLERY_PNG], 'b.png', { type: 'image/png' })
				]);

				const { client } = await connect(userId, ['gallery:read', 'gallery:write']);
				const call = async (name: string, args: Record<string, unknown>) => {
					const res: any = await client.callTool({ name, arguments: args });
					expect(res.isError, res.content?.[0]?.text).toBeFalsy();
					return JSON.parse(res.content[0].text);
				};

				const listed = await call('roamarr_gallery_list', { ownerType: 'place', ownerId: place.id });
				expect(listed.items).toHaveLength(2);
				expect(listed.items[0].filename).toBe('a.png');
				// The projection never exposes attachment internals.
				expect(listed.items[0].attachmentId).toBeUndefined();
				expect(listed.items[0].storageKey).toBeUndefined();

				const captioned = await call('roamarr_gallery_set_caption', {
					imageId: added[0].id,
					caption: 'Sunset'
				});
				expect(captioned.caption).toBe('Sunset');

				const reordered = await call('roamarr_gallery_reorder', {
					ownerType: 'place',
					ownerId: place.id,
					imageIds: [added[1].id, added[0].id]
				});
				expect(reordered.items.map((i: { filename: string }) => i.filename)).toEqual(['b.png', 'a.png']);

				const badOrder: any = await client.callTool({
					name: 'roamarr_gallery_reorder',
					arguments: { ownerType: 'place', ownerId: place.id, imageIds: [added[0].id] }
				});
				expect(badOrder.isError).toBe(true);

				const denied: any = await client.callTool({
					name: 'roamarr_gallery_remove',
					arguments: { imageId: added[1].id }
				});
				expect(denied.isError).toBe(true);
				expect(denied.content[0].text).toContain('confirm');

				const removed = await call('roamarr_gallery_remove', { imageId: added[1].id, confirm: true });
				expect(removed.ok).toBe(true);
				expect(
					(await call('roamarr_gallery_list', { ownerType: 'place', ownerId: place.id })).items
				).toHaveLength(1);
			});
		});

		test("galleries of another user's trip or place are not visible or mutable", async () => {
			await withAttachmentsDir(async () => {
				const other = makeUser(ctx.kit).id;
				const trip = tripsRepo.createTrip(other, { name: 'Other trip' });
				const { createPlace } = await import('./places');
				const { addGalleryImages } = await import('./gallery');
				const place = createPlace(other, { name: 'Foreign' });
				const [image] = await addGalleryImages(other, 'place', place.id, [
					new File([GALLERY_PNG], 'a.png', { type: 'image/png' })
				]);

				const { client } = await connect(userId, ['gallery:read', 'gallery:write']);
				const listTrip: any = await client.callTool({
					name: 'roamarr_gallery_list',
					arguments: { ownerType: 'trip', ownerId: trip.id }
				});
				expect(listTrip.isError).toBe(true);
				const listPlace: any = await client.callTool({
					name: 'roamarr_gallery_list',
					arguments: { ownerType: 'place', ownerId: place.id }
				});
				expect(listPlace.isError).toBe(true);
				const removed: any = await client.callTool({
					name: 'roamarr_gallery_remove',
					arguments: { imageId: image.id, confirm: true }
				});
				expect(removed.isError).toBe(true);
			});
		});

		test('invalid ownerType is rejected', async () => {
			const { client } = await connect(userId, ['gallery:read']);
			const res: any = await client.callTool({
				name: 'roamarr_gallery_list',
				arguments: { ownerType: 'user', ownerId: 1 }
			});
			expect(res.isError).toBe(true);
			expect(res.content[0].text).toContain('ownerType');
		});
	});

	describe('trip day optimization tools', () => {
		const DAY = '2026-07-10';
		const UNTIMED = '2026-07-10T00:00:00Z';

		function seedDay(ownerId: number) {
			const trip = makeTrip(ctx.kit, ownerId, { name: 'Optimize me' });
			const a = makeSegment(ctx.kit, trip.id, { type: 'poi', startAt: UNTIMED, cityLat: 0, cityLng: 0 });
			const b = makeSegment(ctx.kit, trip.id, { type: 'poi', startAt: UNTIMED, cityLat: 0, cityLng: 1 });
			const c = makeSegment(ctx.kit, trip.id, { type: 'poi', startAt: UNTIMED, cityLat: 0, cityLng: 2 });
			return { trip, segments: [a, b, c] };
		}

		test('both tools are advertised', async () => {
			const { client } = await connect(userId, ['segments:read', 'segments:write']);
			const { tools } = await client.listTools();
			const names = tools.map((t) => t.name);
			expect(names).toContain('roamarr_trip_day_optimize');
			expect(names).toContain('roamarr_trip_day_directions_url');
		});

		test('optimize requires segments:write, directions requires segments:read', async () => {
			const { trip } = seedDay(userId);
			const { client } = await connect(userId, ['trips:read']);
			const deniedWrite: any = await client.callTool({
				name: 'roamarr_trip_day_optimize',
				arguments: { tripId: trip.id, date: DAY, confirm: true }
			});
			expect(deniedWrite.isError).toBe(true);
			expect(deniedWrite.content[0].text).toContain('segments:write');
			const deniedRead: any = await client.callTool({
				name: 'roamarr_trip_day_directions_url',
				arguments: { tripId: trip.id, date: DAY }
			});
			expect(deniedRead.isError).toBe(true);
			expect(deniedRead.content[0].text).toContain('segments:read');
		});

		test('without confirm the optimizer previews and persists nothing', async () => {
			const { trip, segments } = seedDay(userId);
			const { client } = await connect(userId, ['segments:write']);
			const res: any = await client.callTool({
				name: 'roamarr_trip_day_optimize',
				arguments: { tripId: trip.id, date: DAY }
			});
			expect(res.isError).toBeFalsy();
			const parsed = JSON.parse(res.content[0].text);
			expect(parsed.preview).toBe(true);
			expect(parsed.applied).toBe(false);
			expect(parsed.orderedSegmentIds).toHaveLength(3);
			for (const s of segments) {
				expect(segmentsRepo.getSegmentById(s.id)!.daySortOrder).toBeNull();
			}
		});

		test('with confirm the optimizer applies and persists day_sort_order', async () => {
			const { trip } = seedDay(userId);
			const { client } = await connect(userId, ['segments:write']);
			const res: any = await client.callTool({
				name: 'roamarr_trip_day_optimize',
				arguments: { tripId: trip.id, date: DAY, confirm: true }
			});
			expect(res.isError).toBeFalsy();
			const parsed = JSON.parse(res.content[0].text);
			expect(parsed.applied).toBe(true);
			parsed.orderedSegmentIds.forEach((id: number, index: number) => {
				expect(segmentsRepo.getSegmentById(id)!.daySortOrder).toBe(index + 1);
			});
		});

		test("optimize on another user's trip is rejected (IDOR)", async () => {
			const other = makeUser(ctx.kit).id;
			const { trip } = seedDay(other);
			const { client } = await connect(userId, ['segments:write']);
			const res: any = await client.callTool({
				name: 'roamarr_trip_day_optimize',
				arguments: { tripId: trip.id, date: DAY, confirm: true }
			});
			expect(res.isError).toBe(true);
			const preview: any = await client.callTool({
				name: 'roamarr_trip_day_optimize',
				arguments: { tripId: trip.id, date: DAY }
			});
			expect(preview.isError).toBe(true);
		});

		test('directions URL assembles origin, destination, and waypoints', async () => {
			const { trip } = seedDay(userId);
			const { client } = await connect(userId, ['segments:read', 'segments:write']);
			await client.callTool({
				name: 'roamarr_trip_day_optimize',
				arguments: { tripId: trip.id, date: DAY, confirm: true }
			});
			const res: any = await client.callTool({
				name: 'roamarr_trip_day_directions_url',
				arguments: { tripId: trip.id, date: DAY }
			});
			expect(res.isError).toBeFalsy();
			const parsed = JSON.parse(res.content[0].text);
			const url = new URL(parsed.url);
			expect(url.origin + url.pathname).toBe('https://www.google.com/maps/dir/');
			expect(url.searchParams.get('origin')).toBe('0,0');
			expect(url.searchParams.get('destination')).toBe('0,2');
			expect(url.searchParams.get('waypoints')).toBe('0,1');
		});

		test('directions URL is null for days with fewer than two points and IDOR-safe', async () => {
			const trip = makeTrip(ctx.kit, userId, { name: 'Sparse' });
			makeSegment(ctx.kit, trip.id, { type: 'note', startAt: UNTIMED });
			const other = makeUser(ctx.kit).id;
			const foreign = makeTrip(ctx.kit, other, { name: 'Foreign' });

			const { client } = await connect(userId, ['segments:read']);
			const res: any = await client.callTool({
				name: 'roamarr_trip_day_directions_url',
				arguments: { tripId: trip.id, date: DAY }
			});
			expect(res.isError).toBeFalsy();
			expect(JSON.parse(res.content[0].text).url).toBeNull();

			const idor: any = await client.callTool({
				name: 'roamarr_trip_day_directions_url',
				arguments: { tripId: foreign.id, date: DAY }
			});
			expect(idor.isError).toBe(true);
		});
	});

	describe('attachment tools', () => {
		async function withAttachmentsDir<T>(fn: () => Promise<T>): Promise<T> {
			const { mkdtempSync, rmSync } = await import('node:fs');
			const { tmpdir } = await import('node:os');
			const path = await import('node:path');
			const original = process.env.ATTACHMENTS_PATH;
			const dir = mkdtempSync(path.join(tmpdir(), 'roamarr-mcp-attachment-'));
			process.env.ATTACHMENTS_PATH = dir;
			try {
				return await fn();
			} finally {
				if (original === undefined) delete process.env.ATTACHMENTS_PATH;
				else process.env.ATTACHMENTS_PATH = original;
				rmSync(dir, { recursive: true, force: true });
			}
		}

		function pdfBytes(body: string): Buffer {
			return Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from(body)]);
		}

		function pdfBase64(body: string): string {
			return pdfBytes(body)
				.toString('base64')
				.replace(/=+$/, '')
				.replace(/\+/g, '-')
				.replace(/\//g, '_');
		}

		async function call(client: Client, name: string, arguments_: Record<string, unknown>) {
			const result: any = await client.callTool({ name, arguments: arguments_ });
			return result;
		}

		function parse(result: { isError?: boolean; content?: Array<{ text?: string }> }) {
			if (result.isError) throw new Error(result.content?.[0]?.text ?? 'tool error');
			return JSON.parse(result.content?.[0]?.text ?? '{}');
		}

		test('lists the attachment tools', async () => {
			const { client } = await connect(userId, ['trips:read']);
			const { tools } = await client.listTools();
			const names = tools.map((t) => t.name);
			expect(names).toHaveLength(144);
			expect(names).toEqual(expect.arrayContaining([
				'roamarr_attachment_upload',
				'roamarr_attachment_list',
				'roamarr_attachment_get',
				'roamarr_attachment_delete'
			]));
			const upload = tools.find((t) => t.name === 'roamarr_attachment_upload');
			expect(upload?.inputSchema.required).toEqual(['filename', 'mimeType', 'contentBase64']);
			const remove = tools.find((t) => t.name === 'roamarr_attachment_delete');
			expect(remove?.inputSchema.required).toEqual(['documentId']);
		});

		test('read tools require trips:read and write tools require trips:write', async () => {
			const reader = await connect(userId, ['trips:write']);
			const listed: any = await call(reader.client, 'roamarr_attachment_list', { tripId: 1 });
			expect(listed.isError).toBe(true);
			expect(listed.content[0].text).toContain('trips:read');

			const writer = await connect(userId, ['trips:read']);
			const uploaded: any = await call(writer.client, 'roamarr_attachment_upload', {
				tripId: 1,
				filename: 'voucher.pdf',
				mimeType: 'application/pdf',
				contentBase64: pdfBase64('nope')
			});
			expect(uploaded.isError).toBe(true);
			expect(uploaded.content[0].text).toContain('trips:write');
			const deleted: any = await call(writer.client, 'roamarr_attachment_delete', {
				documentId: 1,
				confirm: true
			});
			expect(deleted.isError).toBe(true);
			expect(deleted.content[0].text).toContain('trips:write');
		});

		test('uploads, lists, fetches, and deletes a trip PDF', async () => {
			await withAttachmentsDir(async () => {
				const trip = makeTrip(ctx.kit, userId, { name: 'Voucher trip' });
				const { client } = await connect(userId, ['trips:read', 'trips:write']);
				const raw = pdfBytes('shuttle voucher');
				const uploaded: any = await call(client, 'roamarr_attachment_upload', {
					tripId: trip.id,
					filename: 'shuttle.pdf',
					mimeType: 'application/pdf',
					contentBase64: pdfBase64('shuttle voucher'),
					label: 'Shuttle voucher',
					notes: 'gate B'
				});
				expect(uploaded.isError, uploaded.content?.[0]?.text).toBeFalsy();
				const created = parse(uploaded);
				expect(created).toMatchObject({
					tripId: trip.id,
					segmentId: null,
					label: 'Shuttle voucher',
					notes: 'gate B',
					filename: 'shuttle.pdf',
					contentType: 'application/pdf',
					sizeBytes: raw.length
				});
				expect(created.attachmentId).toBeUndefined();
				expect(created.storageKey).toBeUndefined();

				const listed = parse(await call(client, 'roamarr_attachment_list', { tripId: trip.id }));
				expect(listed.items).toHaveLength(1);
				expect(listed.items[0].id).toBe(created.id);
				expect(listed.items[0].attachmentId).toBeUndefined();

				const meta = parse(await call(client, 'roamarr_attachment_get', { documentId: created.id }));
				expect(meta.document.filename).toBe('shuttle.pdf');
				expect(meta.contentBase64).toBeUndefined();

				const got = parse(
					await call(client, 'roamarr_attachment_get', { documentId: created.id, includeContent: true })
				);
				expect(got.contentIncluded).toBe(true);
				expect(Buffer.from(got.contentBase64, 'base64').equals(raw)).toBe(true);

				const unconfirmed: any = await call(client, 'roamarr_attachment_delete', { documentId: created.id });
				expect(unconfirmed.isError).toBe(true);
				expect(unconfirmed.content[0].text).toContain('confirm: true');

				const removed = parse(
					await call(client, 'roamarr_attachment_delete', { documentId: created.id, confirm: true })
				);
				expect(removed).toEqual({ ok: true, documentId: created.id });
				const after: any = await call(client, 'roamarr_attachment_get', { documentId: created.id });
				expect(after.isError).toBe(true);
				expect((await call(client, 'roamarr_attachment_list', { tripId: trip.id })).content[0].text).toContain(
					'"items": []'
				);
			});
		});

		test('attaches a file to a segment and filters the list', async () => {
			await withAttachmentsDir(async () => {
				const trip = makeTrip(ctx.kit, userId, { name: 'Segment files' });
				const flight = makeSegment(ctx.kit, trip.id, { title: 'Flight', type: 'flight' });
				const hotel = makeSegment(ctx.kit, trip.id, { title: 'Hotel', type: 'hotel' });
				const { client } = await connect(userId, ['trips:read', 'trips:write']);
				const onSegment = parse(
					await call(client, 'roamarr_attachment_upload', {
						segmentId: flight.id,
						filename: 'boarding-pass.pdf',
						mimeType: 'Application/PDF',
						contentBase64: pdfBase64('boarding')
					})
				);
				expect(onSegment.tripId).toBe(trip.id);
				expect(onSegment.segmentId).toBe(flight.id);
				expect(onSegment.contentType).toBe('application/pdf');

				const gpx = Buffer.from('<?xml version="1.0"?><gpx version="1.1"><trk></trk></gpx>');
				const track = parse(
					await call(client, 'roamarr_attachment_upload', {
						tripId: trip.id,
						filename: 'hike.gpx',
						mimeType: 'application/gpx+xml',
						contentBase64: gpx.toString('base64')
					})
				);
				expect(track.segmentId).toBeNull();
				expect(track.contentType).toBe('application/gpx+xml');

				const forFlight = parse(
					await call(client, 'roamarr_attachment_list', { segmentId: flight.id })
				);
				expect(forFlight.tripId).toBe(trip.id);
				expect(forFlight.items.map((item: { id: number }) => item.id)).toEqual([onSegment.id]);

				const forHotel = parse(
					await call(client, 'roamarr_attachment_list', { tripId: trip.id, segmentId: hotel.id })
				);
				expect(forHotel.items).toEqual([]);

				const all = parse(await call(client, 'roamarr_attachment_list', { tripId: trip.id }));
				expect(all.items).toHaveLength(2);
			});
		});

		test('rejects invalid uploads and files the caller cannot access', async () => {
			await withAttachmentsDir(async () => {
				const trip = makeTrip(ctx.kit, userId, { name: 'Guarded' });
				const segment = makeSegment(ctx.kit, trip.id, { title: 'Leg' });
				const otherId = makeUser(ctx.kit).id;
				const foreign = makeTrip(ctx.kit, otherId, { name: 'Foreign' });
				const foreignSegment = makeSegment(ctx.kit, foreign.id, { title: 'Theirs' });
				const { client } = await connect(userId, ['trips:read', 'trips:write']);

				const missing: any = await call(client, 'roamarr_attachment_upload', {
					filename: 'a.pdf',
					mimeType: 'application/pdf',
					contentBase64: pdfBase64('x')
				});
				expect(missing.isError).toBe(true);
				expect(missing.content[0].text).toContain('tripId or segmentId is required');

				const pathName: any = await call(client, 'roamarr_attachment_upload', {
					tripId: trip.id,
					filename: '../voucher.pdf',
					mimeType: 'application/pdf',
					contentBase64: pdfBase64('x')
				});
				expect(pathName.isError).toBe(true);
				expect(pathName.content[0].text).toContain('path separators');

				const badType: any = await call(client, 'roamarr_attachment_upload', {
					tripId: trip.id,
					filename: 'notes.txt',
					mimeType: 'text/plain',
					contentBase64: Buffer.from('hello').toString('base64')
				});
				expect(badType.isError).toBe(true);
				expect(badType.content[0].text).toContain('Only JPEG, PNG, WebP, PDF, or GPX');

				const badMagic: any = await call(client, 'roamarr_attachment_upload', {
					tripId: trip.id,
					filename: 'fake.png',
					mimeType: 'image/png',
					contentBase64: pdfBase64('not a png')
				});
				expect(badMagic.isError).toBe(true);
				expect(badMagic.content[0].text).toContain('does not match');

				const badB64: any = await call(client, 'roamarr_attachment_upload', {
					tripId: trip.id,
					filename: 'voucher.pdf',
					mimeType: 'application/pdf',
					contentBase64: '!!!!'
				});
				expect(badB64.isError).toBe(true);
				expect(badB64.content[0].text).toContain('not valid base64');


				const wrongSegment: any = await call(client, 'roamarr_attachment_upload', {
					tripId: trip.id,
					segmentId: foreignSegment.id,
					filename: 'voucher.pdf',
					mimeType: 'application/pdf',
					contentBase64: pdfBase64('x')
				});
				expect(wrongSegment.isError).toBe(true);
				expect(wrongSegment.content[0].text).toContain('Segment not found on this trip');

				const created = parse(
					await call(client, 'roamarr_attachment_upload', {
						tripId: trip.id,
						segmentId: segment.id,
						filename: 'mine.pdf',
						mimeType: 'application/pdf',
						contentBase64: pdfBase64('mine')
					})
				);
				const stranger = await connect(otherId, ['trips:read', 'trips:write']);
				for (const [name, arguments_] of [
					['roamarr_attachment_list', { tripId: trip.id }],
					['roamarr_attachment_list', { segmentId: segment.id }],
					['roamarr_attachment_get', { documentId: created.id, includeContent: true }],
					['roamarr_attachment_upload', {
						tripId: trip.id,
						filename: 'nope.pdf',
						mimeType: 'application/pdf',
						contentBase64: pdfBase64('nope')
					}],
					['roamarr_attachment_delete', { documentId: created.id, confirm: true }]
				] as const) {
					const denied: any = await call(stranger.client, name, arguments_);
					expect(denied.isError, name).toBe(true);
				}
				const stillThere = parse(await call(client, 'roamarr_attachment_list', { tripId: trip.id }));
				expect(stillThere.items).toHaveLength(1);

				const wrongTrip: any = await call(client, 'roamarr_attachment_get', {
					documentId: created.id,
					tripId: foreign.id,
					includeContent: true
				});
				expect(wrongTrip.isError).toBe(true);
				const wrongDelete: any = await call(client, 'roamarr_attachment_delete', {
					documentId: created.id,
					tripId: foreign.id,
					confirm: true
				});
				expect(wrongDelete.isError).toBe(true);
				expect(
					parse(await call(client, 'roamarr_attachment_list', { tripId: trip.id })).items
				).toHaveLength(1);
			});
		});

		test('a read share can fetch a file and an edit share can upload one', async () => {
			await withAttachmentsDir(async () => {
				const trip = makeTrip(ctx.kit, userId, { name: 'Shared files' });
				const readerId = makeUser(ctx.kit).id;
				const editorId = makeUser(ctx.kit).id;
				makeShare(ctx.kit, { tripId: trip.id, sharedWithUserId: readerId, permission: 'read' });
				makeShare(ctx.kit, { tripId: trip.id, sharedWithUserId: editorId, permission: 'edit' });
				const owner = await connect(userId, ['trips:read', 'trips:write']);
				const created = parse(
					await call(owner.client, 'roamarr_attachment_upload', {
						tripId: trip.id,
						filename: 'voucher.pdf',
						mimeType: 'application/pdf',
						contentBase64: pdfBase64('shared voucher')
					})
				);

				const reader = await connect(readerId, ['trips:read', 'trips:write']);
				const listed = parse(await call(reader.client, 'roamarr_attachment_list', { tripId: trip.id }));
				expect(listed.items[0].filename).toBe('voucher.pdf');
				const got = parse(
					await call(reader.client, 'roamarr_attachment_get', {
						documentId: created.id,
						includeContent: true
					})
				);
				expect(Buffer.from(got.contentBase64, 'base64').toString('utf8')).toContain('shared voucher');
				const readerUpload: any = await call(reader.client, 'roamarr_attachment_upload', {
					tripId: trip.id,
					filename: 'extra.pdf',
					mimeType: 'application/pdf',
					contentBase64: pdfBase64('extra')
				});
				expect(readerUpload.isError).toBe(true);
				const readerDelete: any = await call(reader.client, 'roamarr_attachment_delete', {
					documentId: created.id,
					confirm: true
				});
				expect(readerDelete.isError).toBe(true);

				const editor = await connect(editorId, ['trips:write', 'trips:read']);
				const added = parse(
					await call(editor.client, 'roamarr_attachment_upload', {
						tripId: trip.id,
						filename: 'editor.pdf',
						mimeType: 'application/pdf',
						contentBase64: pdfBase64('editor copy')
					})
				);
				expect(added.filename).toBe('editor.pdf');
				expect(parse(await call(owner.client, 'roamarr_attachment_list', { tripId: trip.id })).items).toHaveLength(
					2
				);
			});
		});

		test('attachment_list and attachment_get redact notes unless the PII gate passes', async () => {
			await withAttachmentsDir(async () => {
				const savedPii = getSettings().allowMcpPii;
				try {
					updateSettings({ allowMcpPii: false });
					const trip = makeTrip(ctx.kit, userId, { name: 'Private notes trip' });
					const owner = await connect(userId, ['trips:read', 'trips:write']);
					const created = parse(
						await call(owner.client, 'roamarr_attachment_upload', {
							tripId: trip.id,
							filename: 'private.pdf',
							mimeType: 'application/pdf',
							contentBase64: pdfBase64('private'),
							label: 'Private doc',
							notes: 'booking ref 4451 gate B'
						})
					);

					const readerId = makeUser(ctx.kit).id;
					makeShare(ctx.kit, { tripId: trip.id, sharedWithUserId: readerId, permission: 'read' });
					const detailReaderId = makeUser(ctx.kit).id;
					makeShare(ctx.kit, {
						tripId: trip.id,
						sharedWithUserId: detailReaderId,
						permission: 'read',
						showDetails: true
					});

					const expectFields = (doc: any) => {
						expect(doc.filename).toBe('private.pdf');
						expect(doc.label).toBe('Private doc');
						expect(doc.id).toBe(created.id);
					};

					// Reader with trips:read only, flag off: notes redacted on both tools.
					const reader = await connect(readerId, ['trips:read']);
					const listedRaw = await call(reader.client, 'roamarr_attachment_list', { tripId: trip.id });
					const listed = parse(listedRaw);
					expect(listed.items[0].notes).toBeNull();
					expectFields(listed.items[0]);
					const gotRaw = await call(reader.client, 'roamarr_attachment_get', { documentId: created.id });
					const got = parse(gotRaw);
					expect(got.document.notes).toBeNull();
					expectFields(got.document);
					expect(listedRaw.content[0].text).not.toContain('booking ref 4451 gate B');
					expect(gotRaw.content[0].text).not.toContain('booking ref 4451 gate B');

					// Scope alone is not enough: trips:read + private-details:read with flag off.
					const scopedReader = await connect(readerId, ['trips:read', 'private-details:read']);
					const scopedDetailReader = await connect(detailReaderId, ['trips:read', 'private-details:read']);
					const scopedListed = parse(
						await call(scopedDetailReader.client, 'roamarr_attachment_list', { tripId: trip.id })
					);
					expect(scopedListed.items[0].notes).toBeNull();
					expectFields(scopedListed.items[0]);
					const scopedGot = parse(
						await call(scopedDetailReader.client, 'roamarr_attachment_get', { documentId: created.id })
					);
					expect(scopedGot.document.notes).toBeNull();
					expectFields(scopedGot.document);

					// Gate on: share without showDetails still gets null even with private-details:read;
					// share with showDetails: true + private-details:read and owner + private-details:read get the note.
					updateSettings({ allowMcpPii: true });
					const noDetailsListed = parse(
						await call(scopedReader.client, 'roamarr_attachment_list', { tripId: trip.id })
					);
					expect(noDetailsListed.items[0].notes).toBeNull();
					expectFields(noDetailsListed.items[0]);
					const noDetailsGot = parse(
						await call(scopedReader.client, 'roamarr_attachment_get', { documentId: created.id })
					);
					expect(noDetailsGot.document.notes).toBeNull();
					expectFields(noDetailsGot.document);

					const scopedListed2 = parse(
						await call(scopedDetailReader.client, 'roamarr_attachment_list', { tripId: trip.id })
					);
					expect(scopedListed2.items[0].notes).toBe('booking ref 4451 gate B');
					expectFields(scopedListed2.items[0]);
					const scopedGot2 = parse(
						await call(scopedDetailReader.client, 'roamarr_attachment_get', { documentId: created.id })
					);
					expect(scopedGot2.document.notes).toBe('booking ref 4451 gate B');
					expectFields(scopedGot2.document);
					const plainListed = parse(await call(reader.client, 'roamarr_attachment_list', { tripId: trip.id }));
					expect(plainListed.items[0].notes).toBeNull();
					expectFields(plainListed.items[0]);
					const plainGot = parse(await call(reader.client, 'roamarr_attachment_get', { documentId: created.id }));
					expect(plainGot.document.notes).toBeNull();
					expectFields(plainGot.document);

					const ownerPii = await connect(userId, ['trips:read', 'private-details:read']);
					const ownerPiiListed = parse(await call(ownerPii.client, 'roamarr_attachment_list', { tripId: trip.id }));
					expect(ownerPiiListed.items[0].notes).toBe('booking ref 4451 gate B');
					const ownerPiiGot = parse(await call(ownerPii.client, 'roamarr_attachment_get', { documentId: created.id }));
					expect(ownerPiiGot.document.notes).toBe('booking ref 4451 gate B');

					// Owner with trips:read only, flag off: null on both tools.
					updateSettings({ allowMcpPii: false });
					const ownerRead = await connect(userId, ['trips:read']);
					const ownerListed = parse(await call(ownerRead.client, 'roamarr_attachment_list', { tripId: trip.id }));
					expect(ownerListed.items[0].notes).toBeNull();
					expectFields(ownerListed.items[0]);
					const ownerGot = parse(await call(ownerRead.client, 'roamarr_attachment_get', { documentId: created.id }));
					expect(ownerGot.document.notes).toBeNull();
					expectFields(ownerGot.document);
				} finally {
					updateSettings({ allowMcpPii: savedPii });
				}
			});
		});

		test('returns the full content of large files and supports ranged reads', async () => {
			await withAttachmentsDir(async () => {
				const trip = makeTrip(ctx.kit, userId, { name: 'Large voucher' });
				const { client } = await connect(userId, ['trips:read', 'trips:write']);
				const bytes = Buffer.alloc(12 * 1024 * 1024 + 3);
				for (let i = 0; i < bytes.length; i += 4093) bytes[i] = i % 251;
				bytes.set(Buffer.from('%PDF-1.4\n'), 0);
				const uploaded = parse(
					await call(client, 'roamarr_attachment_upload', {
						tripId: trip.id,
						filename: 'long.pdf',
						mimeType: 'application/pdf',
						contentBase64: bytes.toString('base64')
					})
				);
				expect(uploaded.sizeBytes).toBe(bytes.length);

				const got = parse(
					await call(client, 'roamarr_attachment_get', { documentId: uploaded.id, includeContent: true })
				);
				expect(got.contentIncluded).toBe(true);
				expect(got.complete).toBe(true);
				expect(got.nextOffset).toBeNull();
				expect(got.totalBytes).toBe(bytes.length);
				expect(got.contentBytes).toBe(bytes.length);
				expect(got.document.filename).toBe('long.pdf');
				expect(Buffer.from(got.contentBase64, 'base64').equals(bytes)).toBe(true);

				// Chunked read across encryption chunk boundaries reassembles the same bytes.
				const parts: Buffer[] = [];
				let offset: number | null = 0;
				const chunk = 5 * 1024 * 1024 + 11;
				while (offset !== null) {
					const part = parse(
						await call(client, 'roamarr_attachment_get', {
							documentId: uploaded.id,
							includeContent: true,
							offset,
							length: chunk
						})
					);
					expect(part.contentOffset).toBe(offset);
					parts.push(Buffer.from(part.contentBase64, 'base64'));
					offset = part.nextOffset;
				}
				expect(parts).toHaveLength(3);
				expect(Buffer.concat(parts).equals(bytes)).toBe(true);

				const past: any = await call(client, 'roamarr_attachment_get', {
					documentId: uploaded.id,
					includeContent: true,
					offset: bytes.length + 1
				});
				expect(past.isError).toBe(true);
				const badLength: any = await call(client, 'roamarr_attachment_get', {
					documentId: uploaded.id,
					includeContent: true,
					length: 0
				});
				expect(badLength.isError).toBe(true);
			});
		});
	});

	describe('roamarr_trip_list pagination', () => {
		test('loads only the requested page of trips', async () => {
			for (let i = 0; i < 5; i++) makeTrip(ctx.kit, userId, { name: `Page trip ${i}` });
			const { client } = await connect(userId, ['trips:read']);
			const loadSpy = vi.spyOn(tripsShared, 'loadTripFor');
			try {
				const res: any = await client.callTool({ name: 'roamarr_trip_list', arguments: { limit: 2 } });
				expect(res.isError).toBeFalsy();
				const data = JSON.parse(res.content[0].text);
				expect(data.items).toHaveLength(2);
				expect(loadSpy).toHaveBeenCalledTimes(2);
			} finally {
				loadSpy.mockRestore();
			}
		});

		test('walks every viewable trip in list order with stable cursors', async () => {
			for (let i = 0; i < 5; i++) makeTrip(ctx.kit, userId, { name: `Order trip ${i}` });
			const { client } = await connect(userId, ['trips:read']);
			const ids: number[] = [];
			let cursor: string | null = null;
			let finalNextCursor: string | null = 'unset';
			let pageCount = 0;
			for (;;) {
				const args: Record<string, unknown> = { limit: 2 };
				if (cursor != null) args.cursor = cursor;
				const res: any = await client.callTool({ name: 'roamarr_trip_list', arguments: args });
				expect(res.isError).toBeFalsy();
				const data = JSON.parse(res.content[0].text);
				expect(data.items.length).toBeLessThanOrEqual(2);
				ids.push(...data.items.map((t: any) => Number(t.id)));
				pageCount += 1;
				expect(pageCount).toBeLessThan(20);
				finalNextCursor = data.nextCursor ?? null;
				if (data.nextCursor == null) break;
				cursor = data.nextCursor;
			}
			expect(finalNextCursor).toBeNull();
			expect(ids).toEqual(tripsRepo.listViewableTripIdsForUser(userId).map(Number));
		});

		test('item shape is unchanged', async () => {
			for (let i = 0; i < 3; i++) makeTrip(ctx.kit, userId, { name: `Shape trip ${i}` });
			const { client } = await connect(userId, ['trips:read']);
			const res: any = await client.callTool({ name: 'roamarr_trip_list', arguments: { limit: 1 } });
			expect(res.isError).toBeFalsy();
			const data = JSON.parse(res.content[0].text);
			expect(data.items).toHaveLength(1);
			expect(data.nextCursor).not.toBeNull();
			expect(Object.keys(data.items[0])).toEqual([
				'id', 'name', 'destination', 'destinationCountryCode', 'destinationAdmin1Code',
				'destinationCityName', 'startDate', 'endDate', 'status'
			]);
		});
	});
	describe('share tools', () => {
		let shareCounter = 0;

		function setupShare(permission: 'read' | 'edit' = 'read', showDetails = false) {
			const n = ++shareCounter;
			const ownerId = makeUser(ctx.kit, { email: `share-owner-${n}@x.c` }).id;
			const otherId = makeUser(ctx.kit, { email: `share-other-${n}@x.c` }).id;
			const trip = tripsRepo.createTrip(ownerId, { name: `Share-${n}` });
			const share = tripsRepo.createShare({
				tripId: trip.id,
				sharedWithUserId: otherId,
				permission,
				showDetails
			});
			return { ownerId, otherId, trip, share };
		}

		describe('roamarr_share_update', () => {
			test('applies a permission change and leaves showDetails unchanged', async () => {
				const { ownerId, share } = setupShare('read', false);
				const { client } = await connect(ownerId, ['sharing:write']);
				const res: any = await client.callTool({
					name: 'roamarr_share_update',
					arguments: { shareId: share.id, permission: 'edit' }
				});
				expect(res.isError).toBeFalsy();
				const after = tripsRepo.getShareById(share.id)!;
				expect(after.permission).toBe('edit');
				expect(after.showDetails).toBe(false);
			});

			test('toggles showDetails only, then back', async () => {
				const { ownerId, share } = setupShare('read', false);
				const { client } = await connect(ownerId, ['sharing:write']);
				const res: any = await client.callTool({
					name: 'roamarr_share_update',
					arguments: { shareId: share.id, showDetails: true }
				});
				expect(res.isError).toBeFalsy();
				const after = tripsRepo.getShareById(share.id)!;
				expect(after.showDetails).toBe(true);
				expect(after.permission).toBe('read');

				const res2: any = await client.callTool({
					name: 'roamarr_share_update',
					arguments: { shareId: share.id, showDetails: false }
				});
				expect(res2.isError).toBeFalsy();
				expect(tripsRepo.getShareById(share.id)!.showDetails).toBe(false);
			});

			test('rejects a call with neither key provided', async () => {
				const { ownerId, share } = setupShare('read', false);
				const { client } = await connect(ownerId, ['sharing:write']);
				for (const args of [{ shareId: share.id }, { shareId: share.id, permission: null, showDetails: null }]) {
					const res: any = await client.callTool({ name: 'roamarr_share_update', arguments: args });
					expect(res.isError).toBe(true);
					expect(String(res.content?.[0]?.text ?? '')).toContain('permission or showDetails');
				}
				const after = tripsRepo.getShareById(share.id)!;
				expect(after.permission).toBe('read');
				expect(after.showDetails).toBe(false);
			});

			test('rejects invalid permission values', async () => {
				const { ownerId, share } = setupShare('read', false);
				const { client } = await connect(ownerId, ['sharing:write']);
				for (const permission of ['owner', 'EDIT', '', 7, true, ['edit']]) {
					const res: any = await client.callTool({
						name: 'roamarr_share_update',
						arguments: { shareId: share.id, permission }
					});
					expect(res.isError, JSON.stringify(permission)).toBe(true);
					expect(String(res.content?.[0]?.text ?? '')).toContain('permission');
				}
				const after = tripsRepo.getShareById(share.id)!;
				expect(after.permission).toBe('read');
				expect(after.showDetails).toBe(false);
			});

			test('rejects non-boolean showDetails values', async () => {
				const { ownerId, share } = setupShare('read', false);
				const { client } = await connect(ownerId, ['sharing:write']);
				for (const showDetails of ['false', 'true', 0, 1, '', {}]) {
					const res: any = await client.callTool({
						name: 'roamarr_share_update',
						arguments: { shareId: share.id, showDetails }
					});
					expect(res.isError, JSON.stringify(showDetails)).toBe(true);
					expect(String(res.content?.[0]?.text ?? '')).toContain('showDetails');
				}
				const after = tripsRepo.getShareById(share.id)!;
				expect(after.showDetails).toBe(false);
				expect(after.permission).toBe('read');
			});

			test('rejects invalid shareId values', async () => {
				const { ownerId, share } = setupShare('read', false);
				const { client } = await connect(ownerId, ['sharing:write']);
				for (const shareId of ['1', true, 0, 1.5]) {
					const res: any = await client.callTool({
						name: 'roamarr_share_update',
						arguments: { shareId, permission: 'edit' }
					});
					expect(res.isError, JSON.stringify(shareId)).toBe(true);
					expect(String(res.content?.[0]?.text ?? '')).toContain('shareId');
				}
				const after = tripsRepo.getShareById(share.id)!;
				expect(after.permission).toBe('read');
				expect(after.showDetails).toBe(false);
			});

			test('rejects a non-owner even with sharing:write', async () => {
				const { otherId, share } = setupShare('read', false);
				const { client } = await connect(otherId, ['sharing:write']);
				const res: any = await client.callTool({
					name: 'roamarr_share_update',
					arguments: { shareId: share.id, permission: 'edit', showDetails: true }
				});
				expect(res.isError).toBe(true);
				const after = tripsRepo.getShareById(share.id)!;
				expect(after.permission).toBe('read');
				expect(after.showDetails).toBe(false);
			});

			test('returns Share not found for an unknown shareId', async () => {
				const { ownerId } = setupShare('read', false);
				const { client } = await connect(ownerId, ['sharing:write']);
				const res: any = await client.callTool({
					name: 'roamarr_share_update',
					arguments: { shareId: 999999, permission: 'edit' }
				});
				expect(res.isError).toBe(true);
				expect(String(res.content?.[0]?.text ?? '')).toContain('Share not found');
			});
		});

		describe('roamarr_share_create', () => {
			test('creates a user share with an explicit permission', async () => {
				const ownerId = makeUser(ctx.kit).id;
				const other = makeUser(ctx.kit);
				const trip = tripsRepo.createTrip(ownerId, { name: 'Create trip' });
				const { client } = await connect(ownerId, ['sharing:write']);
				const res: any = await client.callTool({
					name: 'roamarr_share_create',
					arguments: { tripId: trip.id, kind: 'user', email: other.email, permission: 'edit' }
				});
				expect(res.isError).toBeFalsy();
				const after = tripsRepo.getDirectShareForTrip(trip.id, other.id)!;
				expect(after.permission).toBe('edit');
				expect(after.showDetails).toBe(false);
			});

			test('rejects an invalid permission and creates no row', async () => {
				const ownerId = makeUser(ctx.kit).id;
				const other = makeUser(ctx.kit);
				const trip = tripsRepo.createTrip(ownerId, { name: 'Create trip' });
				const { client } = await connect(ownerId, ['sharing:write']);
				const res: any = await client.callTool({
					name: 'roamarr_share_create',
					arguments: { tripId: trip.id, kind: 'user', email: other.email, permission: 'owner' }
				});
				expect(res.isError).toBe(true);
				expect(String(res.content?.[0]?.text ?? '')).toContain('permission');
				expect(tripsRepo.getDirectShareForTrip(trip.id, other.id)).toBeNull();
			});

			test('rejects non-boolean showDetails values and creates no row', async () => {
				for (const showDetails of ['false', 1]) {
					const ownerId = makeUser(ctx.kit).id;
					const other = makeUser(ctx.kit);
					const trip = tripsRepo.createTrip(ownerId, { name: 'Create trip' });
					const { client } = await connect(ownerId, ['sharing:write']);
					const res: any = await client.callTool({
						name: 'roamarr_share_create',
						arguments: { tripId: trip.id, kind: 'user', email: other.email, showDetails }
					});
					expect(res.isError, JSON.stringify(showDetails)).toBe(true);
					expect(String(res.content?.[0]?.text ?? '')).toContain('showDetails');
					expect(tripsRepo.getDirectShareForTrip(trip.id, other.id)).toBeNull();
				}
			});

			test('creates a share with showDetails true', async () => {
				const ownerId = makeUser(ctx.kit).id;
				const other = makeUser(ctx.kit);
				const trip = tripsRepo.createTrip(ownerId, { name: 'Create trip' });
				const { client } = await connect(ownerId, ['sharing:write']);
				const res: any = await client.callTool({
					name: 'roamarr_share_create',
					arguments: { tripId: trip.id, kind: 'user', email: other.email, showDetails: true }
				});
				expect(res.isError).toBeFalsy();
				expect(tripsRepo.getDirectShareForTrip(trip.id, other.id)!.showDetails).toBe(true);
			});

			test('defaults to read and showDetails false when keys are absent', async () => {
				const ownerId = makeUser(ctx.kit).id;
				const other = makeUser(ctx.kit);
				const trip = tripsRepo.createTrip(ownerId, { name: 'Create trip' });
				const { client } = await connect(ownerId, ['sharing:write']);
				const res: any = await client.callTool({
					name: 'roamarr_share_create',
					arguments: { tripId: trip.id, kind: 'user', email: other.email }
				});
				expect(res.isError).toBeFalsy();
				const after = tripsRepo.getDirectShareForTrip(trip.id, other.id)!;
				expect(after.permission).toBe('read');
				expect(after.showDetails).toBe(false);
			});

			test('rejects non-boolean showDetails for a public share and leaves the token unset', async () => {
				const ownerId = makeUser(ctx.kit).id;
				const trip = tripsRepo.createTrip(ownerId, { name: 'Create trip' });
				const { client } = await connect(ownerId, ['sharing:write']);
				const res: any = await client.callTool({
					name: 'roamarr_share_create',
					arguments: { tripId: trip.id, kind: 'public', showDetails: 'false' }
				});
				expect(res.isError).toBe(true);
				expect(String(res.content?.[0]?.text ?? '')).toContain('showDetails');
				expect(tripsRepo.getTripById(trip.id)?.publicToken).toBeNull();
			});

			test('rejects malformed tripId cleanly without throwing RangeError', async () => {
				const ownerId = makeUser(ctx.kit).id;
				const { client } = await connect(ownerId, ['sharing:write']);
				for (const badId of ['abc', 0, -1, 1.5, null]) {
					const res: any = await client.callTool({
						name: 'roamarr_share_create',
						arguments: { tripId: badId, kind: 'public' }
					});
					expect(res.isError).toBe(true);
					expect(String(res.content?.[0]?.text ?? '')).toContain('tripId');
				}
			});
		});
	});
});
