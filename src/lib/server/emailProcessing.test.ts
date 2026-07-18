import { beforeEach, expect, test, vi } from 'vitest';

const context = vi.hoisted(() => ({ kit: null as never }));
vi.mock('./db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(context, freshDb());
	return context;
});

import { buildEmailIngestionReply, findUserForEmailSender, getEmailProcessingConfig, matchTrip, parseAiJson, parseEmailForUser, parseTravelEmailLocal, saveEmailProcessingConfig } from './emailProcessing';
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

test('OAuth client credentials exchange supplies the parser bearer token', async () => {
	const user = makeUser(db(), { email: 'oauth-ai@example.com' });
	updateSettings({ allowUserParsingProviders: true });
	saveEmailProcessingConfig(user.id, {
		enabled: false, imapHost: null, imapPort: null, imapSecurity: 'ssl/tls', imapUsername: null,
		imapMailbox: 'INBOX', useImapForSmtp: false, smtpHost: null, smtpPort: null,
		smtpSecurity: 'starttls', smtpUsername: null, smtpFrom: null, aiEnabled: true,
		aiBaseUrl: 'https://ai.example/v1', aiModel: 'travel', aiTokenUrl: 'https://auth.example/token',
		aiClientId: 'client', aiClientSecret: 'secret', aiScope: 'parse'
	});
	const fetchMock = vi.spyOn(globalThis, 'fetch')
		.mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'oauth-token' }), { status: 200 }))
		.mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: '{"isTravel":true,"tripName":"Paris","type":"flight","title":"Flight","startAt":"2027-05-03T10:00:00Z"}' } }] }), { status: 200 }));
	await expect(parseEmailForUser(user.id, 'Flight', 'May 3, 2027')).resolves.toMatchObject({ tripName: 'Paris' });
	expect(fetchMock.mock.calls.at(-1)?.[1]?.headers).toMatchObject({ authorization: 'Bearer oauth-token' });
});

test('global inbox sender matching accepts enabled users only', () => {
	const user = makeUser(db(), { email: 'sender@example.com' });
	expect(findUserForEmailSender('SENDER@example.com')?.id).toBe(BigInt(user.id));
	expect(findUserForEmailSender('missing@example.com')).toBeNull();
});

test('ingestion replies explain each result and link to the trip', () => {
	const user = makeUser(db(), { email: 'reply@example.com' });
	const trip = makeTrip(db(), user.id, { name: 'Tokyo' });
	process.env.ORIGIN = 'https://roamarr.example.com/';
	expect(buildEmailIngestionReply({ tripId: trip.id, created: false })).toMatchObject({
		body: 'Roamarr added the travel item to "Tokyo".',
		link: `https://roamarr.example.com/trips/${trip.id}`,
		linkLabel: 'View Trip'
	});
	expect(buildEmailIngestionReply({ tripId: trip.id, created: true }).body).toContain('created "Tokyo"');
	expect(buildEmailIngestionReply(null).body).toContain('could not find travel details');
	expect(buildEmailIngestionReply(null, true).body).toContain('because an error occurred');
	delete process.env.ORIGIN;
});

test('AI parser accepts reasoning and fenced JSON', () => {
	expect(parseAiJson('<think>reasoning</think>\n```json\n{"isTravel":true,"tripName":"Paris","type":"flight","title":"Flight","startAt":"2027-05-03T10:00:00Z"}\n```')).toMatchObject({ tripName: 'Paris' });
});

test.runIf(!!process.env.MINIMAX)('MiniMax OpenAI-compatible parser works live', async () => {
	const user = makeUser(db(), { email: 'minimax-live@example.com' });
	updateSettings({ globalAiEnabled: true, globalAiBaseUrl: 'https://api.minimax.io/v1', globalAiModel: 'MiniMax-M2.7', globalAiToken: encrypt(process.env.MINIMAX!) });
	await expect(parseEmailForUser(user.id, 'Flight confirmation to Paris', 'Flight departure May 3, 2027 at 10:30 AM. Confirmation ABC123.')).resolves.toMatchObject({ isTravel: true, type: 'flight' });
}, 30_000);
