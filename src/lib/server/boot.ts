import { db, kit } from './db';
import { applyMigrations } from './db/migrate';
import { startScheduler } from './scheduler';
import { settings } from './db/schema';
import { ensureDefaultBenefitTemplates } from './benefitTemplates';

export function requireSecret(secret: string | undefined) {
	if (!secret) throw new Error('ROAMARR_SECRET is required to start Roamarr');
}

let booted = false;

/**
 * Idempotent one-time boot: enforce secret, open/migrate the kit database, apply
 * legacy Drizzle migrations, ensure the settings singleton, then start the
 * scheduler. Migrations always run before the scheduler ticks (global constraint:
 * "Migrations run on boot before the scheduler starts").
 */
export function bootApp() {
	if (booted) return;
	booted = true;
	requireSecret(process.env.ROAMARR_SECRET);
	// Trigger lazy open/migrate of the MongrelDB Kit singleton.
	kit.tableNames();
	applyMigrations(db);
	db.insert(settings).values({ id: 1 }).onConflictDoNothing().run();
	ensureDefaultBenefitTemplates(db);
	startScheduler();
}
