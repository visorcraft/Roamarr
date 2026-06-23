import nodemailer from 'nodemailer';
import { eq } from 'drizzle-orm';
import { db } from './db';
import { users, notifications } from './db/schema';
import { getSettings } from './settings';
import { decrypt } from './crypto';

export async function deliver(userId: number, msg: { title: string; body: string; link?: string }) {
	db.insert(notifications)
		.values({ userId, title: msg.title, body: msg.body, link: msg.link ?? null })
		.run();
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
