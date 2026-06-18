export interface PredictionQuestion {
	id: number;
	question: string;
	description: string;
	aiResolution: boolean;
	aiReasoning?: string | null;
	aiConfidence?: number | null;
	status: 'ACTIVE' | 'RESOLVED' | 'CANCELLED';
	resolutionDate: string;
	totalAmount: number;
	yesAmount: number;
	noAmount: number;
	yesPercentage: number;
	noPercentage: number;
	createdAt: string;
	resolvedAt: string | null;
	requiresWebSearch: boolean;
	creator: {
		id: number | null;
		name: string;
		username: string;
		image: string | null;
		nameColor?: string | null;
	};
	userBets?: {
		yesAmount: number;
		noAmount: number;
		totalAmount?: number;
		estimatedYesWinnings?: number;
		estimatedNoWinnings?: number;
		actualYesWinnings?: number;
		actualNoWinnings?: number;
	};
	// fuck gdpr and all that fucking shit
	recentBets?: Array<{
		id?: number;
		side: boolean;
		amount: number;
		createdAt: string;
		user?: {
			id?: number;
			name?: string;
			username?: string;
			image?: string;
			nameColor?: string | null;
		};
	}>;
}
