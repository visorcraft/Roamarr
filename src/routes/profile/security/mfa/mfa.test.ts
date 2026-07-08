import { test, expect, vi, beforeEach } from 'vitest';
import type { KitDatabase } from '@visorcraft/mongreldb-kit';

const ctx = vi.hoisted(() => ({ kit: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { load } from './+page.server';
import { users, userTwoFactor, twoFactorBackupCodes } from '$lib/server/db/mongrelSchema';
import { makeUser } from '../../../../../tests/helpers';

function kitDb(): KitDatabase {
	return (ctx as { kit: KitDatabase }).kit;
}

beforeEach(() => {
	const kit = kitDb();
	kit.deleteFrom(userTwoFactor).executeSync();
	kit.deleteFrom(twoFactorBackupCodes).executeSync();
	kit.deleteFrom(users).executeSync();
});

test('load returns setup QR', async () => {
	const kit = kitDb();
	const u = makeUser(kit, { email: 'u@x.c' });
	const result = (await load({
		locals: { user: u }
	} as any)) as { state: { enabled: boolean }; setup: { secret: string; qr: string } };
	expect(result.state.enabled).toBe(false);
	expect(result.setup).toBeDefined();
	expect(result.setup.secret).toMatch(/^[A-Z2-7]+$/);
	expect(result.setup.qr).toMatch(/^data:image\/png;base64,/);
});
