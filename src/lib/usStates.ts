export const US_STATES: readonly { code: string; name: string }[] = [
	{ code: 'US-AL', name: 'Alabama' },
	{ code: 'US-AK', name: 'Alaska' },
	{ code: 'US-AZ', name: 'Arizona' },
	{ code: 'US-AR', name: 'Arkansas' },
	{ code: 'US-CA', name: 'California' },
	{ code: 'US-CO', name: 'Colorado' },
	{ code: 'US-CT', name: 'Connecticut' },
	{ code: 'US-DE', name: 'Delaware' },
	{ code: 'US-DC', name: 'District of Columbia' },
	{ code: 'US-FL', name: 'Florida' },
	{ code: 'US-GA', name: 'Georgia' },
	{ code: 'US-HI', name: 'Hawaii' },
	{ code: 'US-ID', name: 'Idaho' },
	{ code: 'US-IL', name: 'Illinois' },
	{ code: 'US-IN', name: 'Indiana' },
	{ code: 'US-IA', name: 'Iowa' },
	{ code: 'US-KS', name: 'Kansas' },
	{ code: 'US-KY', name: 'Kentucky' },
	{ code: 'US-LA', name: 'Louisiana' },
	{ code: 'US-ME', name: 'Maine' },
	{ code: 'US-MD', name: 'Maryland' },
	{ code: 'US-MA', name: 'Massachusetts' },
	{ code: 'US-MI', name: 'Michigan' },
	{ code: 'US-MN', name: 'Minnesota' },
	{ code: 'US-MS', name: 'Mississippi' },
	{ code: 'US-MO', name: 'Missouri' },
	{ code: 'US-MT', name: 'Montana' },
	{ code: 'US-NE', name: 'Nebraska' },
	{ code: 'US-NV', name: 'Nevada' },
	{ code: 'US-NH', name: 'New Hampshire' },
	{ code: 'US-NJ', name: 'New Jersey' },
	{ code: 'US-NM', name: 'New Mexico' },
	{ code: 'US-NY', name: 'New York' },
	{ code: 'US-NC', name: 'North Carolina' },
	{ code: 'US-ND', name: 'North Dakota' },
	{ code: 'US-OH', name: 'Ohio' },
	{ code: 'US-OK', name: 'Oklahoma' },
	{ code: 'US-OR', name: 'Oregon' },
	{ code: 'US-PA', name: 'Pennsylvania' },
	{ code: 'US-RI', name: 'Rhode Island' },
	{ code: 'US-SC', name: 'South Carolina' },
	{ code: 'US-SD', name: 'South Dakota' },
	{ code: 'US-TN', name: 'Tennessee' },
	{ code: 'US-TX', name: 'Texas' },
	{ code: 'US-UT', name: 'Utah' },
	{ code: 'US-VT', name: 'Vermont' },
	{ code: 'US-VA', name: 'Virginia' },
	{ code: 'US-WA', name: 'Washington' },
	{ code: 'US-WV', name: 'West Virginia' },
	{ code: 'US-WI', name: 'Wisconsin' },
	{ code: 'US-WY', name: 'Wyoming' }
];

const US_STATE_CODES = new Set(US_STATES.map((s) => s.code));

function toIso3166_2(code: string): string {
	const upper = code.trim().toUpperCase();
	if (upper.startsWith('US-')) return upper;
	return `US-${upper}`;
}

export function normalizeUsStateCode(code: string): string {
	return toIso3166_2(code);
}

export function isUsStateCode(code: string): boolean {
	return US_STATE_CODES.has(toIso3166_2(code));
}

export function usStateName(code: string): string | null {
	const normalized = toIso3166_2(code);
	const match = US_STATES.find((s) => s.code === normalized);
	return match ? match.name : null;
}

export function usStateDisplayCode(code: string): string {
	const normalized = toIso3166_2(code);
	return normalized.slice(3);
}
