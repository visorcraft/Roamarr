import type { IconName } from './icons';

const WMO_CODES: Record<number, string> = {
	0: 'Clear sky',
	1: 'Mainly clear',
	2: 'Partly cloudy',
	3: 'Overcast',
	45: 'Fog',
	48: 'Depositing rime fog',
	51: 'Light drizzle',
	53: 'Moderate drizzle',
	55: 'Dense drizzle',
	56: 'Light freezing drizzle',
	57: 'Dense freezing drizzle',
	61: 'Slight rain',
	63: 'Moderate rain',
	65: 'Heavy rain',
	66: 'Light freezing rain',
	67: 'Heavy freezing rain',
	71: 'Slight snow',
	73: 'Moderate snow',
	75: 'Heavy snow',
	77: 'Snow grains',
	80: 'Slight rain showers',
	81: 'Moderate rain showers',
	82: 'Violent rain showers',
	85: 'Slight snow showers',
	86: 'Heavy snow showers',
	95: 'Thunderstorm',
	96: 'Thunderstorm with slight hail',
	99: 'Thunderstorm with heavy hail'
};

export function weatherCodeSummary(code: number): string {
	return WMO_CODES[code] ?? 'Unknown';
}

export function weatherIconForCode(code: number | null): IconName | null {
	if (code == null) return null;
	if (code === 0) return 'sun';
	if (code <= 3) return 'cloud-sun';
	if (code <= 48) return 'fog';
	if (code <= 57) return 'cloud-drizzle';
	if (code <= 67) return 'cloud-rain';
	if (code <= 77) return 'cloud-snow';
	if (code <= 82) return 'cloud-rain';
	if (code <= 86) return 'cloud-snow';
	if (code <= 99) return 'cloud-lightning';
	return null;
}
