import { describe, test, expect, beforeEach, vi } from 'vitest';
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
import * as travelDataRepo from './repositories/travelDataRepo';
import { addItem as addChecklistItem } from './tripChecklists';
import { trips, visitedCountries, visitedUsStates, tripChecklistItems, users, places, placeCategories, placeLinks } from './db/mongrelSchema';
import { eq as kitEq } from '@visorcraft/mongreldb-kit';
import { makeUser, makeTrip, makeSegment } from '../../../tests/helpers';
import * as segmentsRepo from './repositories/segmentsRepo';
import { updateSettings } from './settings';

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
			['roamarr_medication_list', 'medications:read'],
			['roamarr_important_item_list', 'items:read'],
			['roamarr_entry_requirement_list', 'requirements:read'],
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
			disableEmbeddings();
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

	describe('day notes tools', () => {
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
});
