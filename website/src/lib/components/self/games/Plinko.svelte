<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import {
		Card,
		CardContent,
		CardDescription,
		CardHeader,
		CardTitle
	} from '$lib/components/ui/card';
	import confetti from 'canvas-confetti';
	import { toast } from 'svelte-sonner';
	import { formatValue, playSound, showConfetti, showSchoolPrideCannons } from '$lib/utils';
	import { volumeSettings } from '$lib/stores/volume-settings';
	import { onMount } from 'svelte';
	import { fetchPortfolioSummary } from '$lib/stores/portfolio-data';
	import { haptic } from '$lib/stores/haptics';
	import {
		PLINKO_ROWS,
		PLINKO_RISKS,
		PLINKO_MULTIPLIERS,
		plinkoCenterX,
		type PlinkoRows,
		type PlinkoRisk
	} from '$lib/games/plinko';

	interface PlinkoResult {
		won: boolean;
		path: ('L' | 'R')[];
		bucketIndex: number;
		multiplier: number;
		payout: number;
		newBalance: number;
		amountWagered: number;
		rows: number;
		risk: string;
	}

	const MAX_BET_AMOUNT = 1000000;

	// Board geometry (in % of the board box).
	const PEG_AREA = 76; // pegs occupy the top 76% of the board height
	const BUCKET_Y = 88; // bucket row sits near the bottom
	const HALF_RANGE = 45; // pegs/buckets span 5%..95% horizontally (matches plinkoCenterX)
	const STEP_MS = 120; // ms per peg bounce during the drop animation

	let {
		balance = $bindable(),
		onBalanceUpdate
	}: {
		balance: number;
		onBalanceUpdate?: (newBalance: number) => void;
	} = $props();

	let betAmount = $state(10);
	let betAmountDisplay = $state('10');
	let rows = $state<PlinkoRows>(12);
	let risk = $state<PlinkoRisk>('medium');
	let isDropping = $state(false);
	let lastResult = $state<PlinkoResult | null>(null);

	let showBall = $state(false);
	let ballX = $state(50);
	let ballY = $state(2);
	let landedBucket = $state(-1);

	let canBet = $derived(
		betAmount > 0 && betAmount <= balance && betAmount <= MAX_BET_AMOUNT && !isDropping
	);

	// Multiplier labels for the current (rows, risk) — length = rows + 1.
	const multipliers = $derived(PLINKO_MULTIPLIERS[rows][risk]);

	// Peg positions: row r (0..rows-1) has r+1 pegs, forming a downward triangle.
	const pegs = $derived.by(() => {
		const out: { x: number; y: number }[] = [];
		for (let r = 0; r < rows; r++) {
			const y = ((r + 0.5) / rows) * PEG_AREA;
			for (let k = 0; k <= r; k++) {
				const x = 50 + (2 * k - r) * (HALF_RANGE / rows);
				out.push({ x, y });
			}
		}
		return out;
	});

	function multClass(m: number): string {
		if (m < 1) return 'text-destructive';
		if (m >= 10) return 'text-success';
		if (m >= 2) return 'text-yellow-400';
		return 'text-muted-foreground';
	}

	function setBetAmount(amount: number) {
		const clampedAmount = Math.min(amount, Math.min(balance, MAX_BET_AMOUNT));
		if (clampedAmount >= 0) {
			betAmount = clampedAmount;
			betAmountDisplay = clampedAmount.toLocaleString();
		}
	}

	function handleBetAmountInput(event: Event) {
		const target = event.target as HTMLInputElement;
		const value = target.value.replace(/,/g, '');
		const numValue = parseFloat(value) || 0;
		const clampedValue = Math.min(numValue, Math.min(balance, MAX_BET_AMOUNT));

		betAmount = clampedValue;
		betAmountDisplay = target.value;
	}

	function handleBetAmountBlur() {
		betAmountDisplay = betAmount.toLocaleString();
	}

	function selectRows(r: number) {
		if (!isDropping && (PLINKO_ROWS as readonly number[]).includes(r)) {
			rows = r as PlinkoRows;
			resetBoard();
			haptic.trigger('selection');
			playSound('click');
		}
	}

	function selectRisk(rk: PlinkoRisk) {
		if (!isDropping && risk !== rk) {
			risk = rk;
			resetBoard();
			haptic.trigger('selection');
			playSound('click');
		}
	}

	function resetBoard() {
		landedBucket = -1;
		lastResult = null;
		showBall = false;
	}

	function wait(ms: number) {
		return new Promise<void>((resolve) => setTimeout(resolve, ms));
	}

	async function dropBall() {
		if (!canBet) return;

		isDropping = true;
		lastResult = null;
		landedBucket = -1;
		showBall = true;
		ballX = 50;
		ballY = 2;
		let rights = 0;

		try {
			const response = await fetch('/api/arcade/plinko', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ rows, risk, amount: betAmount })
			});

			if (!response.ok) {
				const errorData = await response.json();
				throw new Error(errorData.error || 'Failed to drop ball');
			}

			const data: PlinkoResult = await response.json();

			playSound('flip');
			await wait(STEP_MS);

			// Animate the ball down the server-decided path, one peg per step.
			for (let i = 0; i < data.path.length; i++) {
				if (data.path[i] === 'R') rights++;
				ballX = 50 + (2 * rights - (i + 1)) * (HALF_RANGE / rows);
				ballY = 2 + ((i + 1) / rows) * (PEG_AREA - 4);
				playSound('click');
				await wait(STEP_MS);
			}

			// Land in the bucket.
			ballY = 82;
			landedBucket = data.bucketIndex;
			await wait(200);

			balance = data.newBalance;
			lastResult = data;
			onBalanceUpdate?.(data.newBalance);

			if (data.won) {
				haptic.trigger('success');
				showConfetti(confetti);
				showSchoolPrideCannons(confetti);
				playSound('win');
			} else {
				haptic.trigger('error');
				playSound('lose');
			}

			isDropping = false;
		} catch (error) {
			console.error('Plinko drop error:', error);
			haptic.trigger('error');
			toast.error('Drop failed', {
				description: error instanceof Error ? error.message : 'Unknown error occurred'
			});
			showBall = false;
			isDropping = false;
		}
	}

	onMount(async () => {
		volumeSettings.load();

		try {
			const data = await fetchPortfolioSummary();
			if (data) {
				balance = data.baseCurrencyBalance;
				onBalanceUpdate?.(data.baseCurrencyBalance);
			}
		} catch (error) {
			console.error('Failed to fetch balance:', error);
		}
	});
</script>

<Card>
	<CardHeader>
		<CardTitle>Plinko</CardTitle>
		<CardDescription>Drop the ball through the pegs — chase the edge buckets for huge multipliers!</CardDescription>
	</CardHeader>
	<CardContent>
		<div class="grid grid-cols-1 gap-8 md:grid-cols-2">
			<!-- Board + result -->
			<div class="flex flex-col space-y-4">
				<div class="text-center">
					<p class="text-muted-foreground text-sm">Balance</p>
					<p class="text-2xl font-bold">{formatValue(balance)}</p>
				</div>

				<div class="flex-1 flex items-center justify-center">
					<div class="plinko-board">
						{#each pegs as peg}
							<span class="peg" style="left: {peg.x}%; top: {peg.y}%"></span>
						{/each}

						{#each multipliers as mult, b}
							<div
								class="bucket"
								class:landed={landedBucket === b}
								style="left: {plinkoCenterX(rows, b)}%; top: {BUCKET_Y}%"
							>
								<span class="bucket-mult {multClass(mult)} {mult >= 10 ? 'font-bold' : ''}"
									>{mult}×</span
								>
							</div>
						{/each}

						{#if showBall}
							<span class="ball" style="left: {ballX}%; top: {ballY}%"></span>
						{/if}
					</div>
				</div>

				<div class="flex items-center justify-center text-center">
					{#if lastResult && !isDropping}
						<div class="bg-muted/50 w-full rounded-lg p-3">
							{#if lastResult.won}
								<p class="text-success font-semibold">
									WIN — {lastResult.multiplier}×
								</p>
								<p class="text-sm">
									Won {formatValue(lastResult.payout)} on {lastResult.rows}/{lastResult.risk}
								</p>
							{:else}
								<p class="text-destructive font-semibold">LOSS</p>
								<p class="text-sm">
									{lastResult.multiplier}× — {formatValue(lastResult.payout)} returned
								</p>
							{/if}
						</div>
					{/if}
				</div>
			</div>

			<!-- Controls -->
			<div class="space-y-4">
				<div>
					<div class="mb-2 block text-sm font-medium">Rows</div>
					<div class="grid grid-cols-3 gap-2">
						{#each PLINKO_ROWS as r}
							<Button
								variant={rows === r ? 'default' : 'outline'}
								onclick={() => selectRows(r)}
								disabled={isDropping}
								class="h-12"
							>
								{r}
							</Button>
						{/each}
					</div>
				</div>

				<div>
					<div class="mb-2 block text-sm font-medium">Risk</div>
					<div class="grid grid-cols-3 gap-2">
						{#each PLINKO_RISKS as rk}
							<Button
								variant={risk === rk ? 'default' : 'outline'}
								onclick={() => selectRisk(rk)}
								disabled={isDropping}
								class="h-12 capitalize"
							>
								{rk}
							</Button>
						{/each}
					</div>
				</div>

				<div>
					<label for="bet-amount" class="mb-2 block text-sm font-medium">Bet Amount</label>
					<Input
						id="bet-amount"
						type="text"
						value={betAmountDisplay}
						oninput={handleBetAmountInput}
						onblur={handleBetAmountBlur}
						disabled={isDropping}
						placeholder="Enter bet amount"
					/>
					<p class="text-muted-foreground mt-1 text-xs">
						Max bet: {MAX_BET_AMOUNT.toLocaleString()}
					</p>
				</div>

				<div>
					<div class="grid grid-cols-4 gap-2">
						<Button
							size="sm"
							variant="outline"
							onclick={() =>
								setBetAmount(Math.floor(Math.min(balance || 0, MAX_BET_AMOUNT) * 0.25))}
							disabled={isDropping}>25%</Button
						>
						<Button
							size="sm"
							variant="outline"
							onclick={() => setBetAmount(Math.floor(Math.min(balance || 0, MAX_BET_AMOUNT) * 0.5))}
							disabled={isDropping}>50%</Button
						>
						<Button
							size="sm"
							variant="outline"
							onclick={() =>
								setBetAmount(Math.floor(Math.min(balance || 0, MAX_BET_AMOUNT) * 0.75))}
							disabled={isDropping}>75%</Button
						>
						<Button
							size="sm"
							variant="outline"
							onclick={() => setBetAmount(Math.floor(Math.min(balance || 0, MAX_BET_AMOUNT)))}
							disabled={isDropping}>Max</Button
						>
					</div>
				</div>

				<Button class="h-12 w-full text-lg" onclick={dropBall} disabled={!canBet}>
					{isDropping ? 'Dropping...' : 'Drop'}
				</Button>
			</div>
		</div>
	</CardContent>
</Card>

<style>
	.plinko-board {
		position: relative;
		width: 100%;
		max-width: 340px;
		aspect-ratio: 3 / 4;
		margin-inline: auto;
	}

	.peg {
		position: absolute;
		width: 8px;
		height: 8px;
		border-radius: 9999px;
		background-color: #94a3b8;
		transform: translate(-50%, -50%);
		pointer-events: none;
	}

	.bucket {
		position: absolute;
		transform: translate(-50%, -50%);
		text-align: center;
		white-space: nowrap;
		border-radius: 6px;
		padding: 2px 3px;
		transition: background-color 0.15s ease, box-shadow 0.15s ease;
	}

	.bucket.landed {
		background-color: rgba(245, 158, 11, 0.18);
		box-shadow: 0 0 0 1.5px rgba(245, 158, 11, 0.9);
	}

	.bucket-mult {
		font-family: var(--font-mono, ui-monospace), monospace;
		font-size: 10px;
		line-height: 1;
	}

	.ball {
		position: absolute;
		width: 13px;
		height: 13px;
		border-radius: 9999px;
		background: radial-gradient(circle at 35% 30%, #fde68a, #f59e0b 70%);
		box-shadow: 0 0 6px rgba(245, 158, 11, 0.7);
		transform: translate(-50%, -50%);
		transition: left 0.12s linear, top 0.12s linear;
		z-index: 2;
		pointer-events: none;
	}
</style>
