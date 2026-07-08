import { describe, expect, test } from 'vitest';
import { auditEntityUrl } from './auditEntityUrl';

function entry(
	entityType: string,
	entityId: number,
	meta: Record<string, unknown> = {}
): Parameters<typeof auditEntityUrl>[0] {
	return {
		id: 1,
		action: 'test',
		entityType,
		entityId,
		meta,
		createdAt: '2024-01-01T00:00:00Z',
		user: { id: 1, email: '', displayName: '' }
	};
}

describe('auditEntityUrl', () => {
	test('links top-level entities directly', () => {
		expect(auditEntityUrl(entry('trip', 5))).toBe('/trips/5');
		expect(auditEntityUrl(entry('user', 7))).toBe('/users/7/edit');
		expect(auditEntityUrl(entry('group', 2))).toBe('/groups/2/edit');
		expect(auditEntityUrl(entry('card', 3))).toBe('/cards/3/edit');
		expect(auditEntityUrl(entry('insurance', 4))).toBe('/insurance/4/edit');
		expect(auditEntityUrl(entry('fare_provider', 6))).toBe('/fare-providers/6/edit');
		expect(auditEntityUrl(entry('settings', 1))).toBe('/general');
	});

	test('links documents by either entity type', () => {
		expect(auditEntityUrl(entry('travel_document', 8))).toBe('/profile/documents/8/edit');
		expect(auditEntityUrl(entry('document', 8))).toBe('/profile/documents/8/edit');
	});

	test('links child entities to their trip when tripId is present', () => {
		expect(auditEntityUrl(entry('segment', 9, { tripId: 5 }))).toBe('/trips/5');
		expect(auditEntityUrl(entry('trip_expense', 10, { tripId: 5 }))).toBe('/trips/5');
		expect(auditEntityUrl(entry('trip_poll', 11, { tripId: 5 }))).toBe('/trips/5');
	});

	test('returns null for child entities without tripId instead of a broken link', () => {
		expect(auditEntityUrl(entry('segment', 9))).toBeNull();
		expect(auditEntityUrl(entry('trip_expense_attachment', 10))).toBeNull();
		expect(auditEntityUrl(entry('trip_poll', 11))).toBeNull();
	});

	test('returns null for entities with no detail route', () => {
		expect(auditEntityUrl(entry('trip_template', 12, { sourceTripId: 5 }))).toBeNull();
		expect(auditEntityUrl(entry('attachment', 13))).toBeNull();
		expect(auditEntityUrl(entry('oauth_client', 'client-1' as unknown as number))).toBeNull();
	});
});
