<script lang="ts">
	import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Textarea } from '$lib/components/ui/textarea';
	import { Alert, AlertDescription } from '$lib/components/ui/alert';
	import { HugeiconsIcon } from '@hugeicons/svelte';
	import {
		Notification01Icon,
		Alert02Icon,
		Loading03Icon,
		Tick01Icon
	} from '@hugeicons/core-free-icons';
	import { toast } from 'svelte-sonner';

	let title = $state('');
	let message = $state('');
	let link = $state('');
	let confirmed = $state(false);
	let sending = $state(false);
	let lastCount = $state<number | null>(null);

	const MAX_TITLE = 200;
	const MAX_MESSAGE = 1000;

	let isValid = $derived(title.trim().length > 0 && message.trim().length > 0 && confirmed);

	async function sendBroadcast() {
		if (!isValid) return;
		sending = true;
		lastCount = null;
		try {
			const res = await fetch('/api/admin/notify/broadcast', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					title: title.trim(),
					message: message.trim(),
					link: link.trim() || undefined
				})
			});

			const data = await res.json();
			if (res.ok) {
				lastCount = data.notifiedCount;
				toast.success(`Broadcast sent to ${data.notifiedCount} users`);
				title = '';
				message = '';
				link = '';
				confirmed = false;
			} else {
				toast.error(data.error || 'Failed to send broadcast');
			}
		} catch (e) {
			toast.error('Failed to send broadcast');
		} finally {
			sending = false;
		}
	}
</script>

<svelte:head>
	<title>Broadcast - Admin | Rugplay</title>
</svelte:head>

<div class="container mx-auto max-w-2xl space-y-4 py-6">
	<div class="flex items-center gap-2">
		<HugeiconsIcon icon={Notification01Icon} class="h-5 w-5" />
		<h2 class="text-lg font-semibold">Broadcast Notification</h2>
	</div>

	<Alert>
		<HugeiconsIcon icon={Alert02Icon} class="h-4 w-4" />
		<AlertDescription>
			This sends a <span class="font-semibold">SYSTEM notification to every user</span> — both a
			persistent row (their notifications page) and a live toast for anyone online.
		</AlertDescription>
	</Alert>

	<div class="grid gap-4 md:grid-cols-2">
		<!-- Compose -->
		<Card>
			<CardHeader class="pb-3">
				<CardTitle class="text-base">Compose</CardTitle>
				<CardDescription class="text-sm">Write the announcement.</CardDescription>
			</CardHeader>
			<CardContent class="space-y-3">
				<div class="space-y-1">
					<div class="flex items-center justify-between">
						<label for="title" class="text-sm font-medium">Title</label>
						<span class="text-muted-foreground text-xs">{title.length}/{MAX_TITLE}</span>
					</div>
					<Input
						id="title"
						bind:value={title}
						maxlength={MAX_TITLE}
						placeholder="🎉 Site maintenance tonight"
					/>
				</div>

				<div class="space-y-1">
					<div class="flex items-center justify-between">
						<label for="message" class="text-sm font-medium">Message</label>
						<span class="text-muted-foreground text-xs">{message.length}/{MAX_MESSAGE}</span>
					</div>
					<Textarea
						id="message"
						bind:value={message}
						maxlength={MAX_MESSAGE}
						rows={4}
						placeholder="The market will be read-only from 2-3am UTC for upgrades."
					/>
				</div>

				<div class="space-y-1">
					<label for="link" class="text-sm font-medium">Link (optional)</label>
					<Input id="link" bind:value={link} placeholder="/about or https://…" />
				</div>

				<label class="flex items-start gap-2 text-sm">
					<input type="checkbox" bind:checked={confirmed} class="mt-0.5 size-4" />
					<span class="text-muted-foreground">
						I understand this is delivered to <span class="font-semibold">all users</span>.
					</span>
				</label>

				<Button onclick={sendBroadcast} disabled={!isValid || sending} class="w-full">
					{#if sending}
						<HugeiconsIcon icon={Loading03Icon} class="h-4 w-4 animate-spin" />
						Sending…
					{:else}
						Send Broadcast
					{/if}
				</Button>

				{#if lastCount !== null}
					<p class="flex items-center justify-center gap-1 text-center text-sm text-green-500">
						<HugeiconsIcon icon={Tick01Icon} class="h-4 w-4" />
						Delivered to {lastCount.toLocaleString()} users
					</p>
				{/if}
			</CardContent>
		</Card>

		<!-- Preview -->
		<Card>
			<CardHeader class="pb-3">
				<CardTitle class="text-base">Preview</CardTitle>
				<CardDescription class="text-sm">How it appears for a user.</CardDescription>
			</CardHeader>
			<CardContent>
				<div class="bg-card flex items-start gap-3 rounded-lg border p-3 shadow-sm">
					<div
						class="bg-primary/10 text-primary flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
					>
						<HugeiconsIcon icon={Notification01Icon} class="h-5 w-5" />
					</div>
					<div class="min-w-0 flex-1">
						<div class="truncate font-semibold">
							{title.trim() || 'Notification title'}
						</div>
						<p class="text-muted-foreground mt-0.5 text-sm break-words">
							{message.trim() || 'Notification message preview.'}
						</p>
						{#if link.trim()}
							<a
								href={link.trim()}
								class="text-primary mt-1 block truncate text-xs hover:underline"
							>
								{link.trim()}
							</a>
						{/if}
					</div>
				</div>
			</CardContent>
		</Card>
	</div>
</div>
