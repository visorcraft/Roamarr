import { test, expect, vi, beforeEach } from 'vitest';

const ctx = vi.hoisted(() => ({ kit: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { eq, type KitDatabase } from '@visorcraft/mongreldb-kit';
import * as repo from './auditRepo';
import * as usersRepo from './usersRepo';
import { auditLogs } from '$lib/server/db/mongrelSchema';

function kitDb(): KitDatabase {
	return (ctx as { kit: KitDatabase }).kit;
}

function makeUser(email: string) {
	return usersRepo.createUser({
		email,
		password_hash: 'x',
		display_name: email,
		calendar_token: null,
		calendar_token_expires_at: null
	});
}

function insertLog(userId: number, action: string, entityType: string, entityId: number, meta: Record<string, unknown> = {}, createdAt?: string) {
	const kit = kitDb();
	const values: Record<string, unknown> = {
		user_id: BigInt(userId),
		action,
		entity_type: entityType,
		entity_id: BigInt(entityId),
		meta_json: JSON.stringify(meta)
	};
	if (createdAt) {
		values.created_at = createdAt;
	}
	return kit.insertInto(auditLogs).values(values as any).executeSync();
}

beforeEach(() => {
	const kit = kitDb();
	kit.deleteFrom(auditLogs).executeSync();
});

test('listAuditLogs without search returns sliced rows and full DB total', () => {
	const u = makeUser('audit-slice@x.c');
	for (let i = 0; i < 5; i++) {
		insertLog(Number(u.id), `action-${i}`, 'trip', i, { idx: i }, `2026-01-0${i + 1}T00:00:00Z`);
	}

	const page1 = repo.listAuditLogs({ limit: 2, offset: 0 });
	expect(page1.logs).toHaveLength(2);
	expect(page1.total).toBe(5);
	expect(page1.logs[0].action).toBe('action-4');
	expect(page1.logs[1].action).toBe('action-3');

	const page2 = repo.listAuditLogs({ limit: 2, offset: 2 });
	expect(page2.logs).toHaveLength(2);
	expect(page2.total).toBe(5);
	expect(page2.logs[0].action).toBe('action-2');
	expect(page2.logs[1].action).toBe('action-1');

	const page3 = repo.listAuditLogs({ limit: 2, offset: 4 });
	expect(page3.logs).toHaveLength(1);
	expect(page3.total).toBe(5);
	expect(page3.logs[0].action).toBe('action-0');
});

test('listAuditLogs with search filters in memory and total matches filtered count', () => {
	const u = makeUser('audit-search@x.c');
	insertLog(Number(u.id), 'trip.create', 'trip', 1, { name: 'Alpha' }, '2026-01-01T00:00:00Z');
	insertLog(Number(u.id), 'trip.update', 'trip', 2, { name: 'Beta' }, '2026-01-02T00:00:00Z');
	insertLog(Number(u.id), 'segment.create', 'segment', 3, { name: 'Gamma' }, '2026-01-03T00:00:00Z');
	insertLog(Number(u.id), 'trip.delete', 'trip', 4, { name: 'Delta' }, '2026-01-04T00:00:00Z');

	const result = repo.listAuditLogs({ search: 'trip', limit: 10, offset: 0 });
	expect(result.logs).toHaveLength(3);
	expect(result.total).toBe(3);
	expect(result.logs.map((l) => l.action)).toEqual([
		'trip.delete',
		'trip.update',
		'trip.create'
	]);

	const byEntity = repo.listAuditLogs({ search: 'segment', limit: 10, offset: 0 });
	expect(byEntity.logs).toHaveLength(1);
	expect(byEntity.total).toBe(1);
	expect(byEntity.logs[0].action).toBe('segment.create');

	const byMeta = repo.listAuditLogs({ search: 'beta', limit: 10, offset: 0 });
	expect(byMeta.logs).toHaveLength(1);
	expect(byMeta.total).toBe(1);
	expect(byMeta.logs[0].action).toBe('trip.update');

	const noMatch = repo.listAuditLogs({ search: 'no-match', limit: 10, offset: 0 });
	expect(noMatch.logs).toHaveLength(0);
	expect(noMatch.total).toBe(0);
});

test('listAuditLogs search respects limit and offset on filtered results', () => {
	const u = makeUser('audit-search-paging@x.c');
	for (let i = 0; i < 5; i++) {
		insertLog(Number(u.id), `trip.create`, 'trip', i, { idx: i }, `2026-01-0${i + 1}T00:00:00Z`);
	}

	const result = repo.listAuditLogs({ search: 'trip', limit: 2, offset: 1 });
	expect(result.logs).toHaveLength(2);
	expect(result.total).toBe(5);
	expect(result.logs[0].entityId).toBe(3);
	expect(result.logs[1].entityId).toBe(2);
});
