<script lang="ts">
	import { enhance } from '$app/forms';
	import CopyButton from '$lib/components/CopyButton.svelte';
	import { useDateFormat } from '$lib/dateFormatContext.svelte';
	import ProfileTabs from '$lib/components/ProfileTabs.svelte';

	let { data, form } = $props<{ data: any; form: { error?: string } | null }>();
	const { formatDateTime } = useDateFormat();
	let submitting = $state(false);
</script>

<header class="page-header">
	<div>
		<h1 class="page-title">Calendar feed</h1>
		<p class="page-subtitle">Subscribe to all your trips with one calendar URL.</p>
	</div>
</header>

<ProfileTabs />

{#if form?.error}<p class="notice notice-error mt-4">{form.error}</p>{/if}

<section class="card mt-6 p-5 sm:p-6">
	{#if data.feedUrl}
		<p class="text-sm">Subscribe to all your trips with one calendar URL.</p>
		<div class="mt-2 flex items-start gap-2">
			<p class="code-chip flex-1 px-2.5 text-xs leading-relaxed">{data.feedUrl}</p>
			<CopyButton text={data.feedUrl} class="btn btn-ghost shrink-0" label="Copy" />
		</div>
		{#if data.calendarTokenExpiresAt}
			<p class="meta mt-2">Expires {formatDateTime(data.calendarTokenExpiresAt)}</p>
		{/if}
		<form
			method="POST"
			action="?/regenerateCalendarToken"
			use:enhance={() => {
				submitting = true;
				return async ({ update }) => {
					await update();
					submitting = false;
				};
			}}
			class="mt-4 flex flex-col gap-2"
		>
			<label for="calendarExpiresAt" class="label">New URL expires (optional)</label>
			<input id="calendarExpiresAt" name="calendarExpiresAt" type="datetime-local" class="input text-sm" />
			<button class="btn btn-primary self-end" class:btn-loading={submitting} disabled={submitting}>
				Regenerate feed URL
			</button>
		</form>
	{:else}
		<p class="empty-text text-left">Generate a single .ics feed URL for all your trips.</p>
		<form
			method="POST"
			action="?/regenerateCalendarToken"
			use:enhance={() => {
				submitting = true;
				return async ({ update }) => {
					await update();
					submitting = false;
				};
			}}
			class="mt-4 flex flex-col gap-2"
		>
			<label for="calendarExpiresAt" class="label">Expires (optional)</label>
			<input id="calendarExpiresAt" name="calendarExpiresAt" type="datetime-local" class="input text-sm" />
			<button class="btn btn-primary self-end" class:btn-loading={submitting} disabled={submitting}>
				Generate feed URL
			</button>
		</form>
	{/if}
</section>
