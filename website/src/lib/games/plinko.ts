// Plinko configuration — shared by the server endpoint (resolution) and the
// client component (rendering bucket labels). Must live OUTSIDE $lib/server/
// so the client can import it.
//
// Mechanic: the ball falls through `rows` rows of pegs. At each row it bounces
// left or right (50/50, one random bit per row). The number of right-bounces is
// the bucket index (0..rows); the multiplier comes from the table below.
//
// Multiplier tables are symmetric (center buckets are common/low, edge buckets
// are rare/high). Each table is tuned to ~0.99 RTP (≈1% house edge, verified):
//   8 rows  — low 0.990, medium 0.989, high 0.991
//   12 rows — low 0.990, medium 0.990, high 0.980
//   16 rows — low 0.990, medium 0.990, high 0.990
// (For comparison, the existing Dice game runs at ~0.50 RTP, so Plinko is far
// more generous — intentional, it's the iconic "fair-feeling" Stake game.)

export const PLINKO_ROWS = [8, 12, 16] as const;
export type PlinkoRows = (typeof PLINKO_ROWS)[number];

export const PLINKO_RISKS = ['low', 'medium', 'high'] as const;
export type PlinkoRisk = (typeof PLINKO_RISKS)[number];

// Matches CRASH_MAX_PAYOUT / Mines cap — sanity ceiling on a single drop.
export const PLINKO_MAX_PAYOUT = 2_000_000;

export const PLINKO_MULTIPLIERS: Record<PlinkoRows, Record<PlinkoRisk, number[]>> = {
	8: {
		low: [5.6, 2.1, 1.1, 1.0, 0.5, 1.0, 1.1, 2.1, 5.6],
		medium: [13, 3, 1.3, 0.7, 0.4, 0.7, 1.3, 3, 13],
		high: [29, 4, 1.5, 0.3, 0.2, 0.3, 1.5, 4, 29]
	},
	12: {
		low: [10, 3, 1.6, 1.4, 1.1, 1.0, 0.5, 1.0, 1.1, 1.4, 1.6, 3, 10],
		medium: [33, 11, 4, 2, 1.1, 0.6, 0.3, 0.6, 1.1, 2, 4, 11, 33],
		high: [130, 26, 8, 2.0, 0.7, 0.2, 0.2, 0.2, 0.7, 2.0, 8, 26, 130]
	},
	16: {
		low: [16, 9, 2, 1.4, 1.4, 1.2, 1.1, 1.0, 0.5, 1.0, 1.1, 1.2, 1.4, 1.4, 2, 9, 16],
		medium: [110, 41, 10, 5, 3, 1.5, 1.0, 0.5, 0.3, 0.5, 1.0, 1.5, 3, 5, 10, 41, 110],
		high: [1000, 130, 26, 9, 4, 2, 0.2, 0.2, 0.2, 0.2, 0.2, 2, 4, 9, 26, 130, 1000]
	}
};

export function isValidPlinkoRows(rows: number): rows is PlinkoRows {
	return (PLINKO_ROWS as readonly number[]).includes(rows);
}

export function isValidPlinkoRisk(risk: string): risk is PlinkoRisk {
	return (PLINKO_RISKS as readonly string[]).includes(risk);
}

/** Horizontal center (in board %) for peg/bucket index `k` out of `rows`. */
export function plinkoCenterX(rows: number, k: number): number {
	// Spans 5%..95% of the board so edge buckets stay on-screen.
	return 50 + (2 * k - rows) * (45 / rows);
}
