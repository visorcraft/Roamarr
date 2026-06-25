export const DEFAULT_THEME_ID = 'midnight-travels';

export const THEMES = [
	{
		id: 'midnight-travels',
		name: 'Midnight Travels',
		description: 'Roamarr classic',
		colorScheme: 'dark',
		themeColor: '#0a0e1a',
		preview: {
			canvas: '#0a0e1a',
			surface: '#121829',
			surface2: '#1a2236',
			sidebar: '#121829',
			text: '#e7ecf5',
			muted: '#94a3b8',
			accent: '#6366f1'
		}
	},
	{
		id: 'system',
		name: 'Follow system',
		description: 'Browser light/dark preference',
		colorScheme: 'dark light',
		themeColor: '#0a0e1a',
		preview: {
			canvas: '#181818',
			surface: '#252525',
			surface2: '#2c2c2c',
			sidebar: '#0e0e0e',
			text: '#f5f5f5',
			muted: '#8c8c8c',
			accent: '#2d7ff9'
		}
	},
	{
		id: 'light',
		name: 'Light',
		description: 'Bright neutral',
		colorScheme: 'light',
		themeColor: '#f5f5f5',
		preview: {
			canvas: '#f5f5f5',
			surface: '#ebebeb',
			surface2: '#e5e5e5',
			sidebar: '#ecf0f4',
			text: '#1a1a1a',
			muted: '#777d88',
			accent: '#2d7ff9'
		}
	},
	{
		id: 'dark',
		name: 'Dark',
		description: 'Neutral dark',
		colorScheme: 'dark',
		themeColor: '#181818',
		preview: {
			canvas: '#181818',
			surface: '#252525',
			surface2: '#2c2c2c',
			sidebar: '#0e0e0e',
			text: '#f5f5f5',
			muted: '#8c8c8c',
			accent: '#2d7ff9'
		}
	},
	{
		id: 'oled-black',
		name: 'OLED Black',
		description: 'Pure black',
		colorScheme: 'dark',
		themeColor: '#000000',
		preview: {
			canvas: '#000000',
			surface: '#050505',
			surface2: '#111111',
			sidebar: '#050505',
			text: '#f5f5f5',
			muted: '#767676',
			accent: '#2d7ff9'
		}
	},
	{
		id: 'gentle-gecko',
		name: 'Gentle Gecko',
		description: 'Black and green',
		colorScheme: 'dark',
		themeColor: '#000000',
		preview: {
			canvas: '#000000',
			surface: '#003322',
			surface2: '#00593d',
			sidebar: '#003322',
			text: '#ffffff',
			muted: '#b8d6ca',
			accent: '#00b86b'
		}
	},
	{
		id: 'black-knight',
		name: 'Black Knight',
		description: 'Black and blue',
		colorScheme: 'dark',
		themeColor: '#000000',
		preview: {
			canvas: '#000000',
			surface: '#003366',
			surface2: '#00478f',
			sidebar: '#003366',
			text: '#ffffff',
			muted: '#b8cce0',
			accent: '#0078d4'
		}
	},
	{
		id: 'diamond',
		name: 'Diamond',
		description: 'Cool teal',
		colorScheme: 'dark',
		themeColor: '#2d5b67',
		preview: {
			canvas: '#2d5b67',
			surface: '#4f7f8c',
			surface2: '#7ca2b1',
			sidebar: '#4f7f8c',
			text: '#b9dae9',
			muted: '#91b0bc',
			accent: '#a5c5d5'
		}
	},
	{
		id: 'dreams',
		name: 'Dreams',
		description: 'Violet and magenta',
		colorScheme: 'dark',
		themeColor: '#210b4b',
		preview: {
			canvas: '#210b4b',
			surface: '#3f1c6d',
			surface2: '#6a2a98',
			sidebar: '#3f1c6d',
			text: '#ff3d94',
			muted: '#b95d91',
			accent: '#b5307e'
		}
	},
	{
		id: 'paranoid',
		name: 'Paranoid',
		description: 'Indigo haze',
		colorScheme: 'dark',
		themeColor: '#1d1d4e',
		preview: {
			canvas: '#1d1d4e',
			surface: '#3f3f88',
			surface2: '#5f5fbf',
			sidebar: '#3f3f88',
			text: '#d2d2f4',
			muted: '#a2a2c8',
			accent: '#9a9ae0'
		}
	},
	{
		id: 'red-velvet',
		name: 'Red Velvet',
		description: 'Deep crimson',
		colorScheme: 'dark',
		themeColor: '#1a0f0f',
		preview: {
			canvas: '#1a0f0f',
			surface: '#3c1414',
			surface2: '#8b2323',
			sidebar: '#3c1414',
			text: '#ffdcdc',
			muted: '#c99b9b',
			accent: '#dc3c3c'
		}
	},
	{
		id: 'subspace',
		name: 'Subspace',
		description: 'Muted purple',
		colorScheme: 'dark',
		themeColor: '#2e1a47',
		preview: {
			canvas: '#2e1a47',
			surface: '#4a2a6a',
			surface2: '#794b8b',
			sidebar: '#4a2a6a',
			text: '#e2c7e6',
			muted: '#b69cbc',
			accent: '#b77bb4'
		}
	},
	{
		id: 'tiefling',
		name: 'Tiefling',
		description: 'Purple and gold',
		colorScheme: 'dark',
		themeColor: '#3a0a4d',
		preview: {
			canvas: '#3a0a4d',
			surface: '#711d9a',
			surface2: '#a42db4',
			sidebar: '#711d9a',
			text: '#f9c54e',
			muted: '#bd9440',
			accent: '#ff5c8a'
		}
	},
	{
		id: 'vibes',
		name: 'Vibes',
		description: 'Neon cyan',
		colorScheme: 'dark',
		themeColor: '#0f0f1e',
		preview: {
			canvas: '#0f0f1e',
			surface: '#1e1e3c',
			surface2: '#cc00ff',
			sidebar: '#1e1e3c',
			text: '#00ffcc',
			muted: '#66a89a',
			accent: '#ffcc00'
		}
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
