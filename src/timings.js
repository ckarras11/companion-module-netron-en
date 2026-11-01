/**
 * All timing values in one place. These are the production values;
 * the test suite shrinks them so tests run in seconds instead of minutes.
 */
export const TIMINGS = {
	/** Hard timeout on every HTTP request to the device */
	requestTimeoutMs: 3000,
	/** After a command, check the device this many times to confirm it changed */
	confirmChecks: 2,
	confirmDelayMs: 1000,
	/** While the device is unreachable, retry with backoff from min up to max */
	minRetryMs: 1000,
	maxRetryMs: 10000,
	/** Minimum time between cue-list loads (initial load and reconnects are exempt) */
	cueListRefreshMs: 30000,
	/** Length of one unit of the "Background check interval (seconds)" config field */
	checkIntervalUnitMs: 1000,
}
