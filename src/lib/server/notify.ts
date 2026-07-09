import { createHmac } from 'node:crypto';
import { eq as kitEq } from '@visorcraft/mongreldb-kit';
import { kit } from './db';
import { users } from './db/mongrelSchema';
import { createNotification } from './repositories/remindersRepo';
import { getSettings } from './settings';
import { resolveSmtpTransport } from './smtpConfig';

function isPrivateOrLocalHostname(hostname: string): boolean {
	const lower = hostname.toLowerCase();
	if (lower === 'localhost') return true;
	// IPv4 loopback and private ranges
	if (lower.startsWith('127.')) return true;
	if (lower.startsWith('10.')) return true;
	if (lower.startsWith('192.168.')) return true;
	if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(lower)) return true;
	if (lower.startsWith('169.254.')) return true; // link-local
	// IPv6 loopback / link-local / unique local
	if (lower === '::1') return true;
	if (lower.startsWith('fe80:')) return true;
	if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
	return false;
}

export function isAllowedWebhookUrl(urlString: string): boolean {
	let url: URL;
	try {
		url = new URL(urlString);
	} catch {
		return false;
	}
	if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
	if (url.username || url.password) return false;
	if (isPrivateOrLocalHostname(url.hostname)) return false;
	return true;
}

type NotificationMessage = { title: string; body: string; link?: string };

interface Channel {
	send(userId: number, msg: NotificationMessage): Promise<void>;
}

const inAppChannel: Channel = {
	async send(userId, msg) {
		createNotification({ userId, title: msg.title, body: msg.body, link: msg.link ?? null });
	}
};

function getUserPreferences(userId: number) {
	const u = kit.selectFrom(users).where(kitEq(users.id, BigInt(userId))).executeSync()[0];
	return {
		email: u?.email_notifications ?? true,
		webhook: u?.webhook_notifications ?? true
	};
}

const smtpChannel: Channel = {
	async send(userId, msg) {
		const prefs = getUserPreferences(userId);
		if (!prefs.email) return;
		const u = kit.selectFrom(users).where(kitEq(users.id, BigInt(userId))).executeSync()[0];
		if (!u) return;
		const resolved = resolveSmtpTransport(userId);
		if (!resolved) return;
		await resolved.transport.sendMail({
			from: resolved.from,
			to: u.email,
			subject: msg.title,
			text: msg.body + (msg.link ? `\n\n${msg.link}` : '')
		});
	}
};

function signWebhookBody(body: string): { signature: string; timestamp: number } {
	const secret = process.env.ROAMARR_SECRET;
	if (!secret) throw new Error('ROAMARR_SECRET is not set');
	const timestamp = Math.floor(Date.now() / 1000);
	const payload = `${timestamp}.${body}`;
	const signature = createHmac('sha256', secret).update(payload).digest('hex');
	return { signature, timestamp };
}

const webhookChannel: Channel = {
	async send(userId, msg) {
		const prefs = getUserPreferences(userId);
		if (!prefs.webhook) return;
		const s = getSettings();
		if (!s.webhookUrl || !isAllowedWebhookUrl(s.webhookUrl)) return;
		const body = JSON.stringify({ title: msg.title, body: msg.body, link: msg.link ?? null });
		const { signature, timestamp } = signWebhookBody(body);
		await fetch(s.webhookUrl, {
			method: 'POST',
			redirect: 'manual',
			headers: {
				'Content-Type': 'application/json',
				'X-Roamarr-Signature': signature,
				'X-Roamarr-Timestamp': String(timestamp)
			},
			body,
			signal: AbortSignal.timeout(10_000)
		});
	}
};

const externalChannels: Channel[] = [smtpChannel, webhookChannel];

export async function deliver(userId: number, msg: NotificationMessage) {
	await inAppChannel.send(userId, msg);
	await Promise.all(externalChannels.map((c) => c.send(userId, msg)));
}

export async function sendMail(
	to: string,
	msg: NotificationMessage,
	userId?: number
): Promise<boolean> {
	const resolved = resolveSmtpTransport(userId);
	if (!resolved) return false;
	await resolved.transport.sendMail({
		from: resolved.from,
		to,
		subject: msg.title,
		text: msg.body + (msg.link ? `\n\n${msg.link}` : '')
	});
	return true;
}
