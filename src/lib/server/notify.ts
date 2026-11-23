import { createHmac } from 'node:crypto';
import { isIP } from 'node:net';
import { eq as kitEq } from '@visorcraft/mongreldb-kit';
import { kit } from './db';
import { users } from './db/mongrelSchema';
import { createNotification } from './repositories/remindersRepo';
import { getSettings } from './settings';
import { resolveSmtpTransport, SMTP_SOCKET_TIMEOUT_MS } from './smtpConfig';
import { decrypt } from './crypto';

function isPrivateIPv4Octets(a: number, b: number, c: number, d: number): boolean {
	if (a === 0) return true; // 0.0.0.0/8 unspecified
	if (a === 10) return true;
	if (a === 127) return true;
	if (a === 169 && b === 254) return true; // link-local
	if (a === 172 && b >= 16 && b <= 31) return true;
	if (a === 192 && b === 168) return true;
	return false;
}

function parseIPv4Octets(hostname: string): number[] | null {
	const parts = hostname.split('.');
	if (parts.length !== 4) return null;
	const octets: number[] = [];
	for (const part of parts) {
		if (!/^\d{1,3}$/.test(part)) return null;
		const n = Number(part);
		if (n < 0 || n > 255) return null;
		octets.push(n);
	}
	return octets;
}

function parseIPv6Groups(hostname: string): number[] | null {
	const parsePart = (part: string): number[] | null => {
		if (part === '') return [];
		// Split off a trailing dotted-quad tail, if present.
		const tail = part.match(/^(.*):(\d{1,3}(?:\.\d{1,3}){3})$/);
		let hexPart = part;
		let quadPart: string | null = null;
		if (tail) {
			hexPart = tail[1];
			quadPart = tail[2];
		} else if (part.includes('.')) {
			hexPart = '';
			quadPart = part;
		}
		const groups: number[] = [];
		if (hexPart !== '') {
			for (const p of hexPart.split(':')) {
				if (!/^[0-9a-fA-F]{1,4}$/.test(p)) return null;
				groups.push(parseInt(p, 16));
			}
		}
		if (quadPart !== null) {
			const octets = quadPart.split('.');
			if (octets.length !== 4) return null;
			const nums: number[] = [];
			for (const o of octets) {
				if (!/^\d{1,3}$/.test(o)) return null;
				const n = Number(o);
				if (n < 0 || n > 255) return null;
				nums.push(n);
			}
			groups.push((nums[0] << 8) | nums[1], (nums[2] << 8) | nums[3]);
		}
		return groups;
	};
	const halves = hostname.split('::');
	if (halves.length > 2) return null;
	if (halves.length === 1) {
		const groups = parsePart(halves[0]);
		if (groups === null || groups.length !== 8) return null;
		return groups;
	}
	const left = parsePart(halves[0]);
	const right = parsePart(halves[1]);
	if (left === null || right === null) return null;
	const missing = 8 - left.length - right.length;
	if (missing < 0) return null;
	return [...left, ...new Array(missing).fill(0), ...right];
}

function isPrivateOrLocalHostname(hostname: string): boolean {
	let lower = hostname.toLowerCase();
	if (lower.startsWith('[') && lower.endsWith(']')) lower = lower.slice(1, -1);
	const ip = isIP(lower);
	if (ip === 4) {
		const octets = parseIPv4Octets(lower);
		if (octets === null) return true; // unparseable — fail closed
		return isPrivateIPv4Octets(octets[0], octets[1], octets[2], octets[3]);
	}
	if (ip === 6) {
		const groups = parseIPv6Groups(lower);
		if (groups === null || groups.length !== 8) return true; // fail closed
		// ::/96 — first 96 bits zero, apply IPv4 rules to the low 32 bits.
		if (groups.slice(0, 6).every((g) => g === 0)) {
			const low = groups[6] * 0x10000 + groups[7];
			return isPrivateIPv4Octets((low >>> 24) & 0xff, (low >>> 16) & 0xff, (low >>> 8) & 0xff, low & 0xff);
		}
		// ::ffff:0:0/96 — first 80 bits zero followed by ffff, IPv4 rules on the low 32 bits.
		if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
			const low = groups[6] * 0x10000 + groups[7];
			return isPrivateIPv4Octets((low >>> 24) & 0xff, (low >>> 16) & 0xff, (low >>> 8) & 0xff, low & 0xff);
		}
		// fc00::/7 unique local
		if ((groups[0] & 0xfe00) === 0xfc00) return true;
		// fe80::/10 link-local
		if ((groups[0] & 0xffc0) === 0xfe80) return true;
		return false;
	}
	// DNS name — drop a single trailing dot, block only localhost and *.localhost.
	if (lower.endsWith('.')) lower = lower.slice(0, -1);
	if (lower === 'localhost') return true;
	if (lower.endsWith('.localhost')) return true;
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

/** ntfy server base URL: https only, no embedded credentials. Self-hosted
 * servers on private addresses are allowed (admin-configured, like SMTP). */
export function isValidNtfyServerUrl(urlString: string): boolean {
	let url: URL;
	try {
		url = new URL(urlString);
	} catch {
		return false;
	}
	if (url.protocol !== 'https:') return false;
	if (url.username || url.password) return false;
	return true;
}

/** ntfy topics are letters, digits, dashes and underscores, up to 64 chars. */
export function isValidNtfyTopic(topic: string): boolean {
	return /^[a-zA-Z0-9_-]{1,64}$/.test(topic);
}

export const DEFAULT_NTFY_SERVER_URL = 'https://ntfy.sh';

/**
 * Upper bound for a single SMTP send, kept just above the socket timeout so a
 * hung/blackholed SMTP server can never stall a scheduler tick or request
 * indefinitely. The race's timer is cleared as soon as the send settles, so it
 * does not pin the event loop or leak timers.
 */
export const SMTP_SEND_DEADLINE_MS = SMTP_SOCKET_TIMEOUT_MS + 5_000;

/**
 * Race a promise against a wall-clock deadline. Rejects with a labeled error
 * if `ms` elapses first. Always clears its timer so callers can't accumulate
 * pending timeouts.
 */
export function withDeadline<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<never>((_resolve, reject) => {
		timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
	});
	return Promise.race([promise, timeout]).finally(() => {
		if (timer) clearTimeout(timer);
	}) as Promise<T>;
}

export type NotificationMessage = { title: string; body: string; link?: string; linkLabel?: string };

function escapeHtml(value: string): string {
	return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}

function mailHtml(msg: NotificationMessage): string | undefined {
	if (!msg.link) return undefined;
	return `<p>${escapeHtml(msg.body).replaceAll('\n', '<br>')}</p><p><a href="${escapeHtml(msg.link)}">${escapeHtml(msg.linkLabel ?? msg.link)}</a></p>`;
}

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
		webhook: u?.webhook_notifications ?? true,
		ntfy: u?.ntfy_notifications ?? true
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
		await withDeadline(
			resolved.transport.sendMail({
				from: resolved.from,
				to: u.email,
				subject: msg.title,
				text: msg.body + (msg.link ? `\n\n${msg.link}` : '')
			}),
			SMTP_SEND_DEADLINE_MS,
			'SMTP send'
		);
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

const ntfyChannel: Channel = {
	async send(userId, msg) {
		const prefs = getUserPreferences(userId);
		if (!prefs.ntfy) return;
		const s = getSettings();
		if (!s.ntfyTopic || !isValidNtfyTopic(s.ntfyTopic)) return;
		const server = (s.ntfyServerUrl || DEFAULT_NTFY_SERVER_URL).replace(/\/+$/, '');
		if (!isValidNtfyServerUrl(server)) return;
		const headers: Record<string, string> = {
			Title: msg.title,
			Tags: 'airplane'
		};
		if (msg.link) headers.Click = msg.link;
		if (s.ntfyToken) headers.Authorization = `Bearer ${decrypt(s.ntfyToken)}`;
		await fetch(`${server}/${s.ntfyTopic}`, {
			method: 'POST',
			redirect: 'manual',
			headers,
			body: msg.body,
			signal: AbortSignal.timeout(10_000)
		});
	}
};

const externalChannels: Channel[] = [smtpChannel, webhookChannel, ntfyChannel];

export async function deliver(userId: number, msg: NotificationMessage) {
	await inAppChannel.send(userId, msg);
	// One failing/slow channel (notably SMTP) must not abort the others or fail the
	// whole scheduler tick. Bound each channel and absorb per-channel failures.
	const results = await Promise.allSettled(externalChannels.map((c) => c.send(userId, msg)));
	for (const r of results) {
		if (r.status === 'rejected') console.error('[notify] channel delivery failed:', r.reason);
	}
}

export async function sendMail(
	to: string,
	msg: NotificationMessage,
	userId?: number
): Promise<boolean> {
	const resolved = resolveSmtpTransport(userId);
	if (!resolved) return false;
	await withDeadline(
		resolved.transport.sendMail({
			from: resolved.from,
			to,
			subject: msg.title,
			text: msg.body + (msg.link ? `\n\n${msg.linkLabel ? `${msg.linkLabel}: ` : ''}${msg.link}` : ''),
			html: mailHtml(msg)
		}),
		SMTP_SEND_DEADLINE_MS,
		'SMTP send'
	);
	return true;
}
