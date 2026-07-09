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
import type { Scope } from './oauth';
import * as tripsRepo from './repositories/tripsRepo';
import { trips, visitedCountries, visitedUsStates, tripChecklistItems } from './db/mongrelSchema';
import { eq as kitEq } from '@visorcraft/mongreldb-kit';
import { makeUser } from '../../../tests/helpers';

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

	test('trips:write creates a trip owned by the token user', async () => {
		const { client } = await connect(userId, ['trips:write', 'trips:read']);
		const res: any = await client.callTool({ name: 'roamarr_trip_create', arguments: { name: 'Lisbon' } });
		expect(res.isError).toBeFalsy();
		const created = JSON.parse(res.content[0].text);
		const row = ctx.kit.selectFrom(trips).where(kitEq(trips.id, BigInt(created.id))).executeSync()[0];
		expect(row.owner_id).toBe(BigInt(userId));
		expect(row.name).toBe('Lisbon');
	});

	test('packing_list_build cannot read another user’s trip (IDOR)', async () => {
		const other = makeUser(ctx.kit).id;
		const otherTrip = tripsRepo.createTrip(other, { name: 'Private' });
		const { client } = await connect(userId, ['packing:write']);
		await expect(
			client.callTool({ name: 'roamarr_packing_list_build', arguments: { tripId: otherTrip.id } })
		).rejects.toThrow();
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
		expect(body.countries.map((c: any) => c.code)).toContain('PT');
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
		const trip = tripsRepo.createTrip(userId, { name: 'Secret' });
		const { createSegment } = await import('./repositories/segmentsRepo');
		createSegment({
			trip_id: BigInt(trip.id),
			type: 'flight',
			title: 'Flight',
			start_at: '2026-07-01T10:00:00Z',
			confirmation_number: 'ABC123',
			details_json: JSON.stringify({ recordLocator: 'XYZ' })
		} as any);

		const { client } = await connect(userId, ['trips:read']);
		const res: any = await client.callTool({ name: 'roamarr_trip_get', arguments: { tripId: trip.id } });
		const text = res.content[0].text;
		expect(text).toContain('Secret');
		expect(text).not.toContain('ABC123');
		expect(text).not.toContain('recordLocator');
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
});
