/**
 * MongrelDB Kit 0.52+ caps every `selectFrom().executeSync()` call at 10000
 * rows regardless of the requested `.limit()`. To keep unbounded list
 * queries future-proof against that engine cap, every repo SELECT that lacks
 * a smaller caller-supplied limit must clamp its fetch at this constant.
 *
 * Keep this value at or below 9500 (engine cap is 10000; 500-row headroom
 * lets tests and tooling add rows without surprise truncation). Bumping it
 * past 10000 silently reintroduces the pre-0.52 behavior of unbounded reads.
 */
export const KIT_EXECUTE_SYNC_CAP = 9_500;
