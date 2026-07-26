/**
 * One-shot: fill missing segment/trip lat/lng from GeoNames when country+city are set.
 *
 * Requires ROAMARR_SECRET (and DATABASE_USER/DATABASE_PASS when the DB was created
 * with credentials). Opens DATABASE_PATH (default ./roamarr-db).
 *
 *   ROAMARR_SECRET=… node --experimental-strip-types \
 *     --import ./scripts/seed-alias-loader.mjs scripts/backfill-city-coords.mjs
 *
 * Stop the app first if it holds an exclusive lock on the same data directory.
 */
if (!process.env.ROAMARR_SECRET) {
	console.error('Error: ROAMARR_SECRET is required');
	process.exit(1);
}

const { backfillMissingCityCoordinates } = await import('../src/lib/server/cityCoordsBackfill.ts');
const result = backfillMissingCityCoordinates();
console.log(JSON.stringify(result, null, 2));
if (result.cityDatabaseEmpty) {
	console.error('City database is empty — import GeoNames under Configuration → Maps first.');
	process.exit(2);
}
