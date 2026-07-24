import { expect, test } from 'vitest';
import { freeTextTravelerNames, peopleDetailMetaLines } from './segmentPeopleDisplay';

const flightDetails = {
	airline: 'Korean Air',
	seats: '34ABC,35BC',
	passengers:
		'Oland Thomas Whitecotton, Nattha Whitecotton, Oland Whitecotton, Christopher Whitecotton, Kataliya Whitecotton',
	tickets:
		'Oland Thomas Whitecotton: 1807338108002; Nattha Whitecotton: 1807338108003; Oland Whitecotton: 1807338108004; Christopher Whitecotton: 1807338108005; Kataliya Whitecotton: 1807338108006'
};

test('meta shows tickets once, not passengers again', () => {
	const lines = peopleDetailMetaLines(flightDetails);
	expect(lines).toHaveLength(1);
	expect(lines[0]).toContain('1807338108002');
	expect(lines.join(' ')).not.toMatch(/Oland Thomas Whitecotton, Nattha/);
});

test('meta falls back to passengers when tickets missing', () => {
	expect(peopleDetailMetaLines({ passengers: 'A, B' })).toEqual(['A, B']);
});

test('meta keeps guests separate from tickets', () => {
	expect(peopleDetailMetaLines({ guests: '4 adults, 1 child', tickets: 'A: 1' })).toEqual([
		'4 adults, 1 child',
		'A: 1'
	]);
});

test('free-text names parse tickets and de-dupe passengers', () => {
	expect(freeTextTravelerNames(flightDetails)).toEqual([
		'Oland Thomas Whitecotton',
		'Nattha Whitecotton',
		'Oland Whitecotton',
		'Christopher Whitecotton',
		'Kataliya Whitecotton'
	]);
});

test('free-text names use passengers when no tickets', () => {
	expect(freeTextTravelerNames({ passengers: 'Ada,  Bea' })).toEqual(['Ada', 'Bea']);
});

test('free-text names include guest and attendees', () => {
	expect(freeTextTravelerNames({ guest: 'Nattha Whitecotton', attendees: 'Oland Whitecotton' })).toEqual([
		'Oland Whitecotton',
		'Nattha Whitecotton'
	]);
});
