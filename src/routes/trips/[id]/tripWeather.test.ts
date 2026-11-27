import { JSDOM } from 'jsdom';
import { render } from 'svelte/server';
import { expect, test } from 'vitest';
import type { DayForecast } from '$lib/server/weather';
import TripWeather from './TripWeather.svelte';

function day(number: number, overrides: Partial<DayForecast> = {}): DayForecast {
	return {
		date: `2026-12-${String(number).padStart(2, '0')}`,
		locationLabel: 'Bangkok',
		tempMin: 75,
		tempMax: 90,
		precipProb: 0,
		windMax: null,
		code: 2,
		summary: 'Partly cloudy',
		...overrides
	};
}

function renderWeather(days: DayForecast[], advisory: string | null = null) {
	const { body } = render(TripWeather, {
		props: { weather: { days, advisory, headline: '', tempUnit: '°F', windUnit: 'mph', degraded: false } }
	});
	return JSDOM.fragment(body).querySelector('section')!;
}

test('previews four forecast dates and keeps the remaining forecast and historical averages in the disclosure', () => {
	const weather = renderWeather([
		day(1, { degraded: true }),
		day(2, { locationLabel: 'Chiang Mai' }),
		day(3),
		day(4),
		day(5),
		day(6, { typical: true, code: null, precipProb: null })
	], 'High wind on 2026-12-01');

	expect(weather.querySelectorAll(':scope > ul time')).toHaveLength(4);
	expect(weather.querySelector(':scope > ul')?.textContent).toContain('Chiang Mai');
	expect(weather.textContent).toContain('Stale forecast');
	expect(weather.textContent).toContain('0% chance of precipitation');
	expect(weather.textContent).toContain('90°F');
	expect(weather.querySelector('.notice')?.textContent).toContain('High wind');
	expect(weather.querySelector('details')?.hasAttribute('open')).toBe(false);
	expect(weather.querySelectorAll('details time')).toHaveLength(2);
	expect(weather.querySelector('details h3')?.textContent).toBe('Historical averages');
});

test('previews historical averages when the trip is outside the forecast window', () => {
	const weather = renderWeather([day(18, { typical: true, code: null, precipProb: null, summary: 'Typical' })]);

	expect(weather.querySelector('h3')?.textContent).toBe('Historical averages');
	expect(weather.querySelector('time')?.dateTime).toBe('2026-12-18');
	expect(weather.querySelector('details')).toBeNull();
});

test('shows a single message when none of the dates has weather data', () => {
	const weather = renderWeather([day(1, { code: null, tempMax: null, tempMin: null, precipProb: null })]);

	expect(weather.textContent).toContain('Weather data is unavailable for these dates.');
	expect(weather.querySelector('time')).toBeNull();
});
