import QRCode from 'qrcode';
import { requireUser } from '$lib/server/auth';
import { generateSecret, getTwoFactorState } from '$lib/server/twoFactor';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const u = requireUser(locals);
	const state = getTwoFactorState(u.id);
	const setup = generateSecret(u.email);
	const qr = await QRCode.toDataURL(setup.otpauthUri, { width: 200, margin: 1 });
	return { state, setup: { secret: setup.secret, otpauthUri: setup.otpauthUri, qr } };
};
