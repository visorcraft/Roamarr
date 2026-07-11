import { beforeEach, expect, test, vi } from 'vitest';

const context = vi.hoisted(() => ({ kit: null as never }));
vi.mock('./db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(context, freshDb());
	return context;
});

import { findUserForEmailSender, getEmailProcessingConfig, matchTrip, parseEmailForUser, parseTravelEmailLocal, saveEmailProcessingConfig } from './emailProcessing';
import { updateSettings } from './settings';
import { encrypt } from './crypto';
import { userEmailProcessingConfigs } from './db/mongrelSchema';
import { makeTrip, makeUser } from '../../../tests/helpers';
import type { KitDatabase } from '@visorcraft/mongreldb-kit';

const db = () => (context as { kit: KitDatabase }).kit;

beforeEach(() => {
	db().deleteFrom(userEmailProcessingConfigs).executeSync();
});

test('local parser extracts a dated flight and matches an overlapping trip', () => {
	const user = makeUser(db(), { email: 'mail@example.com' });
	const trip = makeTrip(db(), user.id, { name: 'Tokyo', startDate: '2027-05-01', endDate: '2027-05-10' });
	const parsed = parseTravelEmailLocal('Flight confirmation to Tokyo', 'Departure: May 3, 2027 at 10:30 AM\nConfirmation: ABC123');
	expect(parsed).toMatchObject({ isTravel: true, type: 'flight', confirmationNumber: 'ABC123' });
	expect(matchTrip(user.id, parsed)?.id).toBe(trip.id);
});

test('email credentials are encrypted and only password presence is returned', () => {
	const user = makeUser(db(), { email: 'secure@example.com' });
	saveEmailProcessingConfig(user.id, {
		enabled: true, imapHost: 'imap.example.com', imapPort: 993, imapSecurity: 'ssl/tls',
		imapUsername: user.email, imapPassword: 'secret', imapMailbox: 'INBOX', useImapForSmtp: true,
		smtpHost: null, smtpPort: null, smtpSecurity: 'starttls', smtpUsername: null, smtpFrom: user.email,
		aiEnabled: false, aiBaseUrl: null, aiModel: null, aiTokenUrl: null, aiClientId: null, aiScope: null
	});
	expect(getEmailProcessingConfig(user.id)?.imapPasswordSet).toBe(true);
	expect(db().selectFrom(userEmailProcessingConfigs).executeSync()[0]!.imap_password).not.toBe('secret');
});

test('global AI parser is used when user provider is unavailable', async () => {
	const user = makeUser(db(), { email: 'global-ai@example.com' });
	updateSettings({ globalAiEnabled: true, globalAiBaseUrl: 'https://ai.example/v1', globalAiModel: 'travel', globalAiToken: encrypt('token') });
	vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ isTravel: true, tripName: 'Paris', type: 'flight', title: 'Flight', startAt: '2027-05-03T10:00:00Z' }) } }] }), { status: 200 }));
	await expect(parseEmailForUser(user.id, 'Flight', 'May 3, 2027')).resolves.toMatchObject({ tripName: 'Paris' });
});

test('global inbox sender matching accepts enabled users only', () => {
	const user = makeUser(db(), { email: 'sender@example.com' });
	expect(findUserForEmailSender('SENDER@example.com')?.id).toBe(BigInt(user.id));
	expect(findUserForEmailSender('missing@example.com')).toBeNull();
});
