import { test, expect } from 'vitest';
import { DEFAULT_THEME_ID, isThemeId, normalizeThemeId, themeForId, THEMES } from './themes';

test('isThemeId recognizes high-contrast', () => {
	expect(isThemeId('high-contrast')).toBe(true);
});

test('normalizeThemeId returns high-contrast when valid', () => {
	expect(normalizeThemeId('high-contrast')).toBe('high-contrast');
});

test('normalizeThemeId falls back to default for unknown theme', () => {
	expect(normalizeThemeId('not-a-theme')).toBe(DEFAULT_THEME_ID);
	expect(normalizeThemeId(null)).toBe(DEFAULT_THEME_ID);
	expect(normalizeThemeId(123)).toBe(DEFAULT_THEME_ID);
});

test('themeForId returns high-contrast option', () => {
	const theme = themeForId('high-contrast');
	expect(theme.id).toBe('high-contrast');
	expect(theme.colorScheme).toBe('dark');
});

test('THEMES contains high-contrast with accessible preview colors', () => {
	const theme = THEMES.find((t) => t.id === 'high-contrast');
	expect(theme).toBeDefined();
	expect(theme?.preview.canvas).toBe('#000000');
	expect(theme?.preview.text).toBe('#ffffff');
	expect(theme?.preview.accent).toBe('#0078d4');
});
