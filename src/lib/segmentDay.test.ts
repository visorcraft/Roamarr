import { expect, test } from 'vitest';
import { sameFlightBooking } from './segmentDay';

test('connects flight legs only when their booking reference matches', () => {
	expect(
		sameFlightBooking(
			{ type: 'flight', confirmationNumber: ' BIP4EG ' },
			{ type: 'flight', confirmationNumber: 'bip4eg' }
		)
	).toBe(true);
	expect(sameFlightBooking({ type: 'flight', confirmationNumber: 'A' }, { type: 'flight', confirmationNumber: 'B' })).toBe(false);
	expect(sameFlightBooking({ type: 'hotel', confirmationNumber: 'A' }, { type: 'flight', confirmationNumber: 'A' })).toBe(false);
});
