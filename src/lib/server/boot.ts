import { kit } from './db';
import { startScheduler } from './scheduler';
import { ensureDefaultBenefitTemplates } from './benefitTemplates';
import { applyPendingRestore, cleanupRestoreOldDirectories } from './restore';
import { validateSecretFormat } from './crypto';

export function requireSecret(secret: string | undefined) {
	if (!secret) throw new Error('ROAMARR_SECRET is required to start Roamarr');
	const validation = validateSecretFormat(secret);
	if (!validation.ok) throw new Error(validation.error);
}

let booted = false;
let missingSecret = false;
let bootError: string | undefined;

export function isMissingSecret() {
	return missingSecret;
}

export function getBootError() {
	return bootError;
}

/**
 * Idempotent one-time boot: enforce secret, apply any pending restore from a
 * previous backup upload, open/migrate the kit database, ensure the settings
 * singleton, then start the scheduler.
 * Migrations always run before the scheduler ticks (global constraint:
 * "Migrations run on boot before the scheduler starts").
 *
 * If ROAMARR_SECRET is not set or the database cannot be opened, the app
 * records the state and returns early so the setup page can render diagnostics.
 * The request handler blocks every other route and the setup action.
 */
export function bootApp() {
	if (booted) return;
	booted = true;
	if (!process.env.ROAMARR_SECRET) {
		missingSecret = true;
		return;
	}

	try {
		requireSecret(process.env.ROAMARR_SECRET);

		// Apply a pending restore before opening the database so the replacement
		// directory is used on this boot.
		applyPendingRestore();

		// Trigger lazy open/migrate of the MongrelDB Kit singleton.
		kit.tableNames();

		// Pending restore is complete; remove the old database directory if one was
		// kept as a backup.
		cleanupRestoreOldDirectories();

		ensureDefaultBenefitTemplates();
		// Warm MiniLM/ONNX if admin previously enabled semantic search (non-blocking).
		void import('./embeddings')
			.then(async ({ getEmbeddingsConfig }) => {
				const cfg = getEmbeddingsConfig();
				if (cfg.enabled && cfg.status === 'ready') {
					const { ensureEmbeddingModel } = await import('./embeddings/model');
					await ensureEmbeddingModel(cfg.model);
				}
			})
			.catch((e) => console.error('[embeddings] warm-up failed', e));
		startScheduler();
	} catch (e) {
		bootError = e instanceof Error ? e.message : String(e);
	}
}
