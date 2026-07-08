import { nowIso } from './tz';
import * as tripsRepo from './repositories/tripsRepo';

export const bumpTripUpdatedAt = (tripId: number) => {
	tripsRepo.updateTrip(tripId, { updatedAt: nowIso() });
};
