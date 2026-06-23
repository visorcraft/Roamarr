import { test, expect, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ db: null as never, sqlite: null as never }));
vi.mock('./db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});
const sent = vi.hoisted(() => [] as Array<Record<string, unknown>>);
vi.mock('nodemailer', () => ({
	default: {
		createTransport: () => ({ sendMail: async (m: Record<string, unknown>) => sent.push(m) })
	}
}));

import { deliver } from './notify';
import { users, notifications, settings } from './db/schema';
import { eq } from 'drizzle-orm';
import { encrypt } from './crypto';

test('always writes in-app; emails only when SMTP configured', async () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const u = db
		.insert(users)
		.values({ email: 'a@x.c', passwordHash: 'x', displayName: 'A' })
		.returning()
		.get();
	await deliver(u.id, { title: 'Hi', body: 'There' });
	expect(db.select().from(notifications).all().length).toBe(1);
	expect(sent.length).toBe(0);
	db.update(settings)
		.set({
			smtpHost: 'smtp.x',
			smtpPort: 587,
			smtpFrom: 'r@x.c',
			smtpPass: encrypt('pw')
		})
		.where(eq(settings.id, 1))
		.run();
	await deliver(u.id, { title: 'Hi2', body: 'There2' });
	expect(sent.length).toBe(1);
	expect(sent[0].to).toBe('a@x.c');
});
