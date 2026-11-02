<script lang="ts">
	type Hold = {
		id: number;
		carrier: string;
		startDate: string;
		endDate: string;
		confirmationNumber: string | null;
		addressLabel: string | null;
		notes: string | null;
		status: 'requested' | 'active' | 'ended' | 'cancelled';
	};

	let {
		holds,
		coverage
	}: {
		holds: Hold[];
		coverage: {
			awayDatesKnown: boolean;
			uncoveredRanges: { start: string; end: string }[];
			warnings: { id: number; message: string }[];
		};
	} = $props();

	let editingId = $state<number | null>(null);

	const statuses = ['requested', 'active', 'ended', 'cancelled'] as const;

	function statusClass(status: Hold['status']) {
		if (status === 'active') return 'badge-green';
		if (status === 'requested') return 'badge-amber';
		if (status === 'cancelled') return 'badge-red';
		return 'badge-slate';
	}

	function warningFor(id: number) {
		return coverage.warnings.find((warning) => warning.id === id)?.message ?? null;
	}
</script>

<section class="trip-modern-panel">
	<div class="trip-modern-panel-head">
		<h2 class="trip-modern-panel-title">Mail holds</h2>
		<a href="https://holdmail.usps.com/holdmail/" target="_blank" rel="noreferrer">USPS Hold Mail</a>
	</div>
	{#if coverage.awayDatesKnown && coverage.uncoveredRanges.length > 0}
		<p class="notice notice-warning">
			Away dates are not fully covered.
			{#each coverage.uncoveredRanges as range, index (range.start)}
				{index > 0 ? '; ' : ''}{range.start === range.end ? range.start : `${range.start} to ${range.end}`}
			{/each}
		</p>
	{:else if !coverage.awayDatesKnown}
		<p class="trip-modern-empty">Set the trip start and end to check which days a hold covers.</p>
	{/if}
	{#if holds.length === 0}
		<p class="trip-modern-empty">No mail holds yet.</p>
	{:else}
		<div class="trip-modern-list">
			{#each holds as hold (hold.id)}
				<div class="trip-modern-list-row">
					<div class="min-w-0">
						<div class="flex flex-wrap items-center gap-2">
							<strong>{hold.carrier}</strong>
							<span class="badge badge-compact {statusClass(hold.status)}">{hold.status}</span>
							<span>{hold.startDate} to {hold.endDate}</span>
						</div>
						{#if hold.addressLabel}<p class="field-help">{hold.addressLabel}</p>{/if}
						{#if hold.confirmationNumber}<p class="field-help">Confirmation {hold.confirmationNumber}</p>{/if}
						{#if hold.notes}<p class="field-help">{hold.notes}</p>{/if}
						{#if warningFor(hold.id)}<p class="notice notice-warning">{warningFor(hold.id)}</p>{/if}
						<p class="field-help">Renewal date {hold.endDate}</p>
					</div>
					<div class="flex flex-wrap gap-2">
						<button type="button" class="btn" onclick={() => (editingId = editingId === hold.id ? null : hold.id)}>Edit</button>
						{#if hold.status !== 'cancelled'}
							<form method="POST" action="?/addNextMailHold">
								<input type="hidden" name="holdId" value={hold.id} />
								<button class="btn" type="submit">Next 30 days</button>
							</form>
						{/if}
						<form method="POST" action="?/deleteMailHold" onsubmit={(event) => { if (!confirm('Delete this mail hold?')) event.preventDefault(); }}>
							<input type="hidden" name="holdId" value={hold.id} />
							<button class="btn" type="submit">Delete</button>
						</form>
					</div>
				</div>
				{#if editingId === hold.id}
					<form method="POST" action="?/updateMailHold" class="trip-modern-form-grid">
						<input type="hidden" name="holdId" value={hold.id} />
						<label class="label" for={`mail-carrier-${hold.id}`}>Carrier</label>
						<input id={`mail-carrier-${hold.id}`} class="input" name="carrier" value={hold.carrier} maxlength="40" required />
						<label class="label" for={`mail-start-${hold.id}`}>Start</label>
						<input id={`mail-start-${hold.id}`} class="input" type="date" name="startDate" value={hold.startDate} required />
						<label class="label" for={`mail-end-${hold.id}`}>End</label>
						<input id={`mail-end-${hold.id}`} class="input" type="date" name="endDate" value={hold.endDate} required />
						<label class="label" for={`mail-status-${hold.id}`}>Status</label>
						<select id={`mail-status-${hold.id}`} class="input" name="status" value={hold.status}>
							{#each statuses as status (status)}
								<option value={status}>{status}</option>
							{/each}
						</select>
						<label class="label" for={`mail-confirm-${hold.id}`}>Confirmation</label>
						<input id={`mail-confirm-${hold.id}`} class="input" name="confirmationNumber" value={hold.confirmationNumber ?? ''} maxlength="80" />
						<label class="label" for={`mail-address-${hold.id}`}>Address label</label>
						<input id={`mail-address-${hold.id}`} class="input" name="addressLabel" value={hold.addressLabel ?? ''} maxlength="120" />
						<label class="label" for={`mail-notes-${hold.id}`}>Notes</label>
						<input id={`mail-notes-${hold.id}`} class="input" name="notes" value={hold.notes ?? ''} maxlength="2000" />
						<button class="btn" type="submit">Save hold</button>
					</form>
				{/if}
			{/each}
		</div>
	{/if}
	<form method="POST" action="?/addMailHold" class="trip-modern-form-grid">
		<label class="label" for="mail-carrier-new">Carrier</label>
		<input id="mail-carrier-new" class="input" name="carrier" value="USPS" maxlength="40" required />
		<label class="label" for="mail-start-new">Start</label>
		<input id="mail-start-new" class="input" type="date" name="startDate" required />
		<label class="label" for="mail-end-new">End</label>
		<input id="mail-end-new" class="input" type="date" name="endDate" required />
		<label class="label" for="mail-status-new">Status</label>
		<select id="mail-status-new" class="input" name="status">
			{#each statuses as status (status)}
				<option value={status}>{status}</option>
			{/each}
		</select>
		<label class="label" for="mail-confirm-new">Confirmation</label>
		<input id="mail-confirm-new" class="input" name="confirmationNumber" maxlength="80" />
		<label class="label" for="mail-address-new">Address label</label>
		<input id="mail-address-new" class="input" name="addressLabel" maxlength="120" />
		<label class="label" for="mail-notes-new">Notes</label>
		<input id="mail-notes-new" class="input" name="notes" maxlength="2000" />
		<button class="btn" type="submit">Add mail hold</button>
	</form>
</section>
