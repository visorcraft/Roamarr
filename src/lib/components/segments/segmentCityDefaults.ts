/** Context key for pre-filling new-segment city fields from the parent trip. */
export const SEGMENT_CITY_DEFAULTS_KEY = 'segmentCityDefaults';

export type SegmentCityDefaults = {
	countryCode: string;
	admin1Code: string;
	cityName: string;
	cityLat: number | null;
	cityLng: number | null;
};
