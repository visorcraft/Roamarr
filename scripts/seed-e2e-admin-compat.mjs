/**
 * One-shot: set a known password on the first admin in a Roamarr DB copy
 * so Playwright e2e can log in. Never run against production live volume.
 */
import { KitDatabase, eq } from '@visorcraft/mongreldb-kit';
import { schema, users } from '../src/lib/server/db/mongrelSchema.ts';
import { hashPassword } from '../src/lib/server/auth.ts';

const path = process.env.DATABASE_PATH;
if (!path) throw new Error('DATABASE_PATH required');
const passphrase = process.env.ROAMARR_SECRET;
const username = process.env.DATABASE_USER;
const password = process.env.DATABASE_PASS;
if (!passphrase || !username || !password) {
	throw new Error('ROAMARR_SECRET, DATABASE_USER, DATABASE_PASS required');
}

const kit = KitDatabase.openSync(path, schema, {
	encryption: { passphrase },
	credentials: { username, password }
});

const e2eEmail = process.env.E2E_ADMIN_EMAIL || 'e2e-admin@roamarr.test';
const e2ePassword = process.env.E2E_ADMIN_PASSWORD || 'e2e-correct-horse-battery-staple';
const password_hash = await hashPassword(e2ePassword);
const now = BigInt(Date.now());

const all = kit.selectFrom(users).executeSync();
if (!all.length) throw new Error('no users in DB');

const existing = kit.selectFrom(users).where(eq(users.email, e2eEmail)).executeSync();
if (existing.length) {
	kit
		.updateTable(users)
		.set({ password_hash, role: 'admin', updated_at: now })
		.where(eq(users.email, e2eEmail))
		.executeSync();
	console.log('UPDATED_E2E_USER', e2eEmail);
} else {
	// On a production copy, reset the existing admin password so e2e can use
	// E2E_ADMIN_EMAIL=ciamos@... if set, otherwise set known hash on first admin
	// and print the email for e2e env.
	const admin = all.find((u) => u.role === 'admin') || all[0];
	kit
		.updateTable(users)
		.set({ password_hash, updated_at: now })
		.where(eq(users.id, admin.id))
		.executeSync();
	console.log('RESET_ADMIN_ON_COPY', admin.email);
	console.log('E2E_ADMIN_EMAIL=' + admin.email);
}

console.log(
	'users',
	kit.selectFrom(users).executeSync().map((u) => ({ id: String(u.id), email: u.email, role: u.role }))
);
console.log('SEED_OK');
if (typeof kit.closeSync === 'function') kit.closeSync();
