export const DEFAULT_THEME_ID = 'midnight-travels';

export const THEMES = [
	{
		id: 'midnight-travels',
		name: 'Midnight Travels',
		description: 'Roamarr classic',
		colorScheme: 'dark',
		themeColor: '#0a0e1a'
	},
	{
		id: 'system',
		name: 'Follow system',
		description: 'Browser light/dark preference',
		colorScheme: 'dark light',
		themeColor: '#0a0e1a'
	},
	{
		id: 'light',
		name: 'Light',
		description: 'Bright neutral',
		colorScheme: 'light',
		themeColor: '#f5f5f5'
	},
	{
		id: 'high-contrast',
		name: 'High Contrast',
		description: 'Maximum accessibility',
		colorScheme: 'dark',
		themeColor: '#000000'
	},
	{
		id: 'dark',
		name: 'Dark',
		description: 'Neutral dark',
		colorScheme: 'dark',
		themeColor: '#181818'
	},
	{
		id: 'oled-black',
		name: 'OLED Black',
		description: 'Pure black',
		colorScheme: 'dark',
		themeColor: '#000000'
	},
	{
		id: 'gentle-gecko',
		name: 'Gentle Gecko',
		description: 'Black and green',
		colorScheme: 'dark',
		themeColor: '#000000'
	},
	{
		id: 'black-knight',
		name: 'Black Knight',
		description: 'Black and blue',
		colorScheme: 'dark',
		themeColor: '#000000'
	},
	{
		id: 'diamond',
		name: 'Diamond',
		description: 'Cool teal',
		colorScheme: 'dark',
		themeColor: '#2d5b67'
	},
	{
		id: 'dreams',
		name: 'Dreams',
		description: 'Violet and magenta',
		colorScheme: 'dark',
		themeColor: '#210b4b'
	},
	{
		id: 'paranoid',
		name: 'Paranoid',
		description: 'Indigo haze',
		colorScheme: 'dark',
		themeColor: '#1d1d4e'
	},
	{
		id: 'red-velvet',
		name: 'Red Velvet',
		description: 'Deep crimson',
		colorScheme: 'dark',
		themeColor: '#1a0f0f'
	},
	{
		id: 'subspace',
		name: 'Subspace',
		description: 'Muted purple',
		colorScheme: 'dark',
		themeColor: '#2e1a47'
	},
	{
		id: 'tiefling',
		name: 'Tiefling',
		description: 'Purple and gold',
		colorScheme: 'dark',
		themeColor: '#3a0a4d'
	},
	{
		id: 'vibes',
		name: 'Vibes',
		description: 'Neon cyan',
		colorScheme: 'dark',
		themeColor: '#0f0f1e'
	}
] as const;

export type ThemeId = (typeof THEMES)[number]['id'];
export type ThemeOption = (typeof THEMES)[number];

const themeIds = new Set<string>(THEMES.map((theme) => theme.id));

export function isThemeId(value: string): value is ThemeId {
	return themeIds.has(value);
}

export function normalizeThemeId(value: unknown): ThemeId {
	return typeof value === 'string' && isThemeId(value) ? value : DEFAULT_THEME_ID;
}

export function themeForId(value: unknown): ThemeOption {
	const id = normalizeThemeId(value);
	return THEMES.find((theme) => theme.id === id) ?? THEMES[0];
}
