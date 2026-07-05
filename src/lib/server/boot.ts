import { kit } from './db';
import { startScheduler } from './scheduler';
import { ensureDefaultBenefitTemplates } from './benefitTemplates';
import { applyPendingRestore, cleanupRestoreOldDirectories } from './restore';

export function requireSecret(secret: string | undefined) {
	if (!secret) throw new Error('ROAMARR_SECRET is required to start Roamarr');
}

let booted = false;
let missingSecret = false;

export function isMissingSecret() {
	return missingSecret;
}

/**
 * Idempotent one-time boot: enforce secret, apply any pending restore from a
 * previous backup upload, open/migrate the kit database, ensure the settings
 * singleton, then start the scheduler.
 * Migrations always run before the scheduler ticks (global constraint:
 * "Migrations run on boot before the scheduler starts").
 *
 * If ROAMARR_SECRET is not set, the app records the missing secret state and
 * returns early. This lets the setup page render with instructions, while the
 * request handler blocks every other route and the setup action.
 */
export function bootApp() {
	if (booted) return;
	booted = true;
	if (!process.env.ROAMARR_SECRET) {
		missingSecret = true;
		return;
	}

	// Apply a pending restore before opening the database so the replacement
	// directory is used on this boot.
	applyPendingRestore();

	// Trigger lazy open/migrate of the MongrelDB Kit singleton.
	kit.tableNames();

	// Pending restore is complete; remove the old database directory if one was
	// kept as a backup.
	cleanupRestoreOldDirectories();

	ensureDefaultBenefitTemplates();
	startScheduler();
}
