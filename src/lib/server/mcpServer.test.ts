import { describe, test, expect, beforeEach, vi } from 'vitest';
import type { KitDatabase } from '@mongreldb/kit';
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
import { trips } from './db/mongrelSchema';
import { eq as kitEq } from '@mongreldb/kit';
import { makeUser } from '../../../tests/helpers';

async function connect(userId: number, scopes: Scope[]) {
	const server = createMcpServer(userId, scopes);
	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
	await server.connect(serverTransport);
	const client = new Client({ name: 'test', version: '1.0.0' }, { capabilities: {} });
	await client.connect(clientTransport);
	return { client, server };
}

describe('mcpServer', () => {
	let userId: number;

	beforeEach(() => {
		ctx.kit.deleteFrom(trips).executeSync();
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
});
