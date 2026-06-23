import type { FareProvider } from './index';

export const stub: FareProvider = {
	key: 'stub',
	label: 'Stub (demo)',
	async check() {
		return { ok: true, summary: 'Fare watch active (stub provider — no live data).' };
	}
};
