<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import ConfirmButton from './ConfirmButton.svelte';
	import TextField from './TextField.svelte';
	import SelectField from './SelectField.svelte';
	import TextAreaField from './TextAreaField.svelte';

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

	const statusMessages = {
		requested: m.mail_holds_status_requested,
		active: m.mail_holds_status_active,
		ended: m.mail_holds_status_ended,
		cancelled: m.mail_holds_status_cancelled
	} satisfies Record<Hold['status'], () => string>;

	function statusLabel(status: Hold['status']): string {
		return statusMessages[status]();
	}
</script>

<section class="trip-modern-panel">
	<div class="trip-modern-panel-head">
		<h2 class="trip-modern-panel-title">{m.mail_holds_title()}</h2>
		<a href="https://holdmail.usps.com/holdmail/" target="_blank" rel="noreferrer">{m.mail_holds_usps_link()}</a>
	</div>
	{#if coverage.awayDatesKnown && coverage.uncoveredRanges.length > 0}
		<p class="notice notice-warning">
			{m.mail_holds_uncovered_warning()}
			{#each coverage.uncoveredRanges as range, index (range.start)}
				{index > 0 ? '; ' : ''}{range.start === range.end ? range.start : m.mail_holds_date_range({ start: range.start, end: range.end })}
			{/each}
		</p>
	{:else if !coverage.awayDatesKnown}
		<p class="trip-modern-empty">{m.mail_holds_coverage_unknown()}</p>
	{/if}
	{#if holds.length === 0}
		<p class="trip-modern-empty">{m.mail_holds_empty()}</p>
	{:else}
		<div class="trip-modern-list">
			{#each holds as hold (hold.id)}
				<div class="trip-modern-list-row">
					<div class="min-w-0">
						<div class="flex flex-wrap items-center gap-2">
							<strong>{hold.carrier}</strong>
							<span class="badge badge-compact {statusClass(hold.status)}">{statusLabel(hold.status)}</span>
							<span>{m.mail_holds_date_range({ start: hold.startDate, end: hold.endDate })}</span>
						</div>
						{#if hold.addressLabel}<p class="field-help">{hold.addressLabel}</p>{/if}
						{#if hold.confirmationNumber}<p class="field-help">{m.mail_holds_confirmation_value({ code: hold.confirmationNumber })}</p>{/if}
						{#if hold.notes}<p class="field-help">{hold.notes}</p>{/if}
						{#if warningFor(hold.id)}<p class="notice notice-warning">{warningFor(hold.id)}</p>{/if}
						<p class="field-help">{m.mail_holds_renewal_date({ day: hold.endDate })}</p>
					</div>
					<div class="flex flex-wrap gap-2">
						<button type="button" class="btn" aria-expanded={editingId === hold.id} onclick={() => (editingId = editingId === hold.id ? null : hold.id)}>{m.mail_holds_action_edit()}</button>
						{#if hold.status !== 'cancelled'}
							<form method="POST" action="?/addNextMailHold">
								<input type="hidden" name="holdId" value={hold.id} />
								<button class="btn" type="submit">{m.mail_holds_action_next_30()}</button>
							</form>
						{/if}
						<form method="POST" action="?/deleteMailHold">
							<input type="hidden" name="holdId" value={hold.id} />
							<ConfirmButton type="submit" class="btn" message={m.mail_holds_delete_confirm()}>{m.mail_holds_action_delete()}</ConfirmButton>
						</form>
					</div>
				</div>
				{#if editingId === hold.id}
					<form method="POST" action="?/updateMailHold" class="trip-modern-form-grid">
						<input type="hidden" name="holdId" value={hold.id} />
						<TextField id={`mail-carrier-${hold.id}`} name="carrier" label={m.mail_holds_carrier_label()} value={hold.carrier} maxlength={40} required />
						<TextField id={`mail-start-${hold.id}`} name="startDate" type="date" label={m.mail_holds_start_label()} value={hold.startDate} required />
						<TextField id={`mail-end-${hold.id}`} name="endDate" type="date" label={m.mail_holds_end_label()} value={hold.endDate} required />
						<SelectField id={`mail-status-${hold.id}`} name="status" label={m.mail_holds_status_label()} value={hold.status}>
							{#each statuses as status (status)}
								<option value={status}>{statusLabel(status)}</option>
							{/each}
						</SelectField>
						<TextField id={`mail-confirm-${hold.id}`} name="confirmationNumber" label={m.mail_holds_confirmation_label()} value={hold.confirmationNumber ?? ''} maxlength={80} />
						<TextField id={`mail-address-${hold.id}`} name="addressLabel" label={m.mail_holds_address_label()} value={hold.addressLabel ?? ''} maxlength={120} />
						<TextAreaField id={`mail-notes-${hold.id}`} name="notes" rows={3} label={m.mail_holds_notes_label()} value={hold.notes ?? ''} maxlength={2000} />
						<button class="btn" type="submit">{m.mail_holds_action_save()}</button>
					</form>
				{/if}
			{/each}
		</div>
	{/if}
	<form method="POST" action="?/addMailHold" class="trip-modern-form-grid">
		<TextField id="mail-carrier-new" name="carrier" label={m.mail_holds_carrier_label()} value="USPS" maxlength={40} required />
		<TextField id="mail-start-new" name="startDate" type="date" label={m.mail_holds_start_label()} required />
		<TextField id="mail-end-new" name="endDate" type="date" label={m.mail_holds_end_label()} required />
		<SelectField id="mail-status-new" name="status" label={m.mail_holds_status_label()} value="requested">
			{#each statuses as status (status)}
				<option value={status}>{statusLabel(status)}</option>
			{/each}
		</SelectField>
		<TextField id="mail-confirm-new" name="confirmationNumber" label={m.mail_holds_confirmation_label()} maxlength={80} />
		<TextField id="mail-address-new" name="addressLabel" label={m.mail_holds_address_label()} maxlength={120} />
		<TextAreaField id="mail-notes-new" name="notes" rows={3} label={m.mail_holds_notes_label()} maxlength={2000} />
		<button class="btn" type="submit">{m.mail_holds_action_add()}</button>
	</form>
</section>
