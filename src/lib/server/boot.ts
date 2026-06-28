import { db, kit } from './db';
import { applyMigrations } from './db/migrate';
import { startScheduler } from './scheduler';
import { ensureDefaultBenefitTemplates } from './benefitTemplates';
import { applyPendingRestore, cleanupRestoreOldDirectories } from './restore';

export function requireSecret(secret: string | undefined) {
	if (!secret) throw new Error('ROAMARR_SECRET is required to start Roamarr');
}

let booted = false;

/**
 * Idempotent one-time boot: enforce secret, apply any pending restore from a
 * previous backup upload, open/migrate the kit database, apply legacy Drizzle
 * migrations, ensure the settings singleton, then start the scheduler.
 * Migrations always run before the scheduler ticks (global constraint:
 * "Migrations run on boot before the scheduler starts").
 */
export function bootApp() {
	if (booted) return;
	booted = true;
	requireSecret(process.env.ROAMARR_SECRET);

	// Apply a pending restore before opening the database so the replacement
	// directory is used on this boot.
	applyPendingRestore();

	// Trigger lazy open/migrate of the MongrelDB Kit singleton.
	kit.tableNames();

	// Pending restore is complete; remove the old database directory if one was
	// kept as a backup.
	cleanupRestoreOldDirectories();

	applyMigrations(db);
	ensureDefaultBenefitTemplates();
	startScheduler();
}
