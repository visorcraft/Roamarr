import { expect, test, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ kit: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { GET, PATCH } from './+server';
import { validateOAuthUser } from '$lib/server/auth';
import { updateSettings } from '$lib/server/settings';
import { makeKitUser } from '../../../../../tests/kitHelpers';

test('mobile email settings validate and never return secrets', async () => {
	const row = makeKitUser({ email: 'mail@example.com', password_hash: 'hash', display_name: 'Mail' });
	const user = validateOAuthUser(Number(row.id));
	updateSettings({ allowUserImap: true, allowUserSmtp: true, allowUserParsingProviders: true });
	const invalid = await PATCH({ locals: { user }, request: new Request('https://roamarr.test/api/mobile/email-processing', { method: 'PATCH', body: JSON.stringify({ section: 'inbound', enabled: true, imapHost: 'imap.example.com', imapUsername: 'mail@example.com' }) }) } as any) as Response;
	expect(invalid.status).toBe(400);
	const saved = await PATCH({ locals: { user }, request: new Request('https://roamarr.test/api/mobile/email-processing', { method: 'PATCH', body: JSON.stringify({ section: 'inbound', enabled: true, imapHost: 'imap.example.com', imapPort: 993, imapSecurity: 'ssl/tls', imapUsername: 'mail@example.com', imapPassword: 'private', imapMailbox: 'INBOX' }) }) } as any) as Response;
	expect(saved.status).toBe(200);
	const response = GET({ locals: { user } } as any) as Response;
	const text = await response.text();
	expect(text).not.toContain('private');
	expect(JSON.parse(text).config.imapPasswordSet).toBe(true);
});
