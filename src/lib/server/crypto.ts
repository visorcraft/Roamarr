import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

let cached: Buffer | null = null;

function key(): Buffer {
	if (cached) return cached;
	const secret = process.env.ROAMARR_SECRET;
	if (!secret) throw new Error('ROAMARR_SECRET is required');
	const raw = Buffer.from(secret, 'base64');
	cached = raw.length === 32 ? raw : scryptSync(secret, 'roamarr.v1', 32);
	return cached;
}

export function aesKey(): Buffer {
	return key();
}

export function encrypt(plain: string): string {
	const nonce = randomBytes(12);
	const c = createCipheriv('aes-256-gcm', key(), nonce);
	const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
	const tag = c.getAuthTag();
	return `v1.${nonce.toString('base64')}.${Buffer.concat([ct, tag]).toString('base64')}`;
}

export function decrypt(blob: string): string {
	const [v, nB, dataB] = blob.split('.');
	if (v !== 'v1') throw new Error('unsupported crypto version');
	const data = Buffer.from(dataB, 'base64');
	const tag = data.subarray(data.length - 16);
	const ct = data.subarray(0, data.length - 16);
	const d = createDecipheriv('aes-256-gcm', key(), Buffer.from(nB, 'base64'));
	d.setAuthTag(tag);
	return Buffer.concat([d.update(ct), d.final()]).toString('utf8');
}
