import { COUNTRIES } from './countries';

export function formatDestination(
	cityName: string | null | undefined,
	countryCode: string | null | undefined
): string {
	const parts: string[] = [];
	if (cityName) parts.push(cityName);
	if (countryCode) {
		const country = COUNTRIES.find((c) => c.code === countryCode);
		parts.push(country ? country.name : countryCode);
	}
	return parts.join(', ');
}
