import nodemailer from 'nodemailer';
import { createHmac } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from './db';
import { users } from './db/schema';
import { createNotification } from './repositories/remindersRepo';
import { getSettings } from './settings';
import { decrypt } from './crypto';

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
	const u = db.select().from(users).where(eq(users.id, userId)).get();
	return {
		email: u?.emailNotifications ?? true,
		webhook: u?.webhookNotifications ?? true
	};
}

const smtpChannel: Channel = {
	async send(userId, msg) {
		const prefs = getUserPreferences(userId);
		if (!prefs.email) return;
		const s = getSettings();
		if (!s.smtpHost || !s.smtpFrom) return;
		const u = db.select().from(users).where(eq(users.id, userId)).get();
		if (!u) return;
		const transport = nodemailer.createTransport({
			host: s.smtpHost,
			port: s.smtpPort ?? 587,
			auth: s.smtpUser
				? { user: s.smtpUser, pass: s.smtpPass ? decrypt(s.smtpPass) : '' }
				: undefined
		});
		await transport.sendMail({
			from: s.smtpFrom,
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
		if (!s.webhookUrl) return;
		const body = JSON.stringify({ title: msg.title, body: msg.body, link: msg.link ?? null });
		const { signature, timestamp } = signWebhookBody(body);
		await fetch(s.webhookUrl, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-Roamarr-Signature': signature,
				'X-Roamarr-Timestamp': String(timestamp)
			},
			body
		});
	}
};

const externalChannels: Channel[] = [smtpChannel, webhookChannel];

export async function deliver(userId: number, msg: NotificationMessage) {
	await inAppChannel.send(userId, msg);
	await Promise.all(externalChannels.map((c) => c.send(userId, msg)));
}

export async function sendMail(to: string, msg: NotificationMessage) {
	const s = getSettings();
	if (!s.smtpHost || !s.smtpFrom) return false;
	const transport = nodemailer.createTransport({
		host: s.smtpHost,
		port: s.smtpPort ?? 587,
		auth: s.smtpUser
			? { user: s.smtpUser, pass: s.smtpPass ? decrypt(s.smtpPass) : '' }
			: undefined
	});
	await transport.sendMail({
		from: s.smtpFrom,
		to,
		subject: msg.title,
		text: msg.body + (msg.link ? `\n\n${msg.link}` : '')
	});
	return true;
}

