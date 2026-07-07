import type { FareProvider } from './index';

export const stub: FareProvider = {
	key: 'stub',
	label: 'Stub (demo)',
	async check(_watch, _apiKey, _signal) {
		return { ok: true, summary: 'Fare watch active (stub provider — no live data).' };
	}
};
