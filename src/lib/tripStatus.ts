export const TRIP_STATUSES = ['planning', 'booked', 'active', 'completed'] as const;
export type TripStatus = (typeof TRIP_STATUSES)[number];
