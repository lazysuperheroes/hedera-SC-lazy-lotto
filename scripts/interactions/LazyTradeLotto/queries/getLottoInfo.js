/**
 * LazyTradeLotto - Get Complete Lottery Information
 *
 * Displays comprehensive information about the LazyTradeLotto contract:
 * - LSH NFT tokens (Gen1, Gen2, Mutant)
 * - Connected contracts (PRNG, LazyGasStation, LazyDelegateRegistry)
 * - Configuration (systemWallet, burnPercentage, pause status)
 * - Lottery statistics (jackpot, wins, payouts, etc.)
 *
 * Usage: node queries/getLottoInfo.js <contractId> [--json]
 * Example: node queries/getLottoInfo.js 0.0.123456
 *
 * Options:
 *   --json    Output results as JSON (for programmatic use)
 */

require('dotenv').config();
const {
	AccountId,
	ContractId,
	TokenId,
} = require('@hashgraph/sdk');
const { loadInterface } = require('../../../../utils/abiLoader');
const { queryContract } = require('../../../../utils/queryHelpers');
const { getArgFlag } = require('../../../../utils/nodeHelpers');
const { getTokenDetails } = require('../../../../utils/hederaMirrorHelpers');

// CLI options
const outputJson = process.argv.includes('--json');

const contractName = 'LazyTradeLotto';
const LAZY_TOKEN_ID = process.env.LAZY_TOKEN_ID;
const LAZY_DECIMAL = parseInt(process.env.LAZY_DECIMALS ?? '1');
const env = process.env.ENVIRONMENT ?? null;

let operatorId;
try {
	operatorId = AccountId.fromString(process.env.ACCOUNT_ID);
}
catch {
	console.log('ERROR: Must specify ACCOUNT_ID in the .env file');
	process.exit(1);
}

async function main() {
	const args = process.argv.slice(2);
	if (args.length === 0 || getArgFlag('h')) {
		console.log('Usage: getLottoInfo.js <contractId>');
		console.log('       contractId: LazyTradeLotto contract address (e.g., 0.0.123456)');
		console.log('\nDisplays comprehensive lottery contract information.');
		return;
	}

	console.log('\n-Using ENVIRONMENT:', env);
	console.log('-Using Operator:', operatorId.toString());

	// Import ABI
	const ltlIface = loadInterface(contractName);

	const contractId = ContractId.fromString(args[0]);
	console.log('-Using Contract:', contractId.toString(), '\n');

	// Get $LAZY token decimals for proper formatting
	let lazyTokenDecimals = LAZY_DECIMAL;
	if (LAZY_TOKEN_ID) {
		const lazyToken = TokenId.fromString(LAZY_TOKEN_ID);
		const lazyTokenDetails = await getTokenDetails(env, lazyToken);
		if (lazyTokenDetails && lazyTokenDetails.decimals !== undefined) {
			lazyTokenDecimals = lazyTokenDetails.decimals;
		}
	}

	// Fetch all contract data
	console.log('Fetching contract data...\n');

	// LSH Tokens
	const lshGen1Result = await queryContract(env, contractId, ltlIface, 'LSH_GEN1', [], operatorId);
	const lshGen1 = lshGen1Result[0];

	const lshGen2Result = await queryContract(env, contractId, ltlIface, 'LSH_GEN2', [], operatorId);
	const lshGen2 = lshGen2Result[0];

	const lshMutantResult = await queryContract(env, contractId, ltlIface, 'LSH_GEN1_MUTANT', [], operatorId);
	const lshMutant = lshMutantResult[0];

	// Connected Contracts
	const prngResult = await queryContract(env, contractId, ltlIface, 'prngSystemContract', [], operatorId);
	const prngContract = prngResult[0];

	const lgsResult = await queryContract(env, contractId, ltlIface, 'lazyGasStation', [], operatorId);
	const lgsContract = lgsResult[0];

	const ldrResult = await queryContract(env, contractId, ltlIface, 'lazyDelegateRegistry', [], operatorId);
	const ldrContract = ldrResult[0];

	// Configuration
	const systemWalletResult = await queryContract(env, contractId, ltlIface, 'systemWallet', [], operatorId);
	const systemWallet = systemWalletResult[0];

	const burnPercentageResult = await queryContract(env, contractId, ltlIface, 'burnPercentage', [], operatorId);
	const burnPercentage = burnPercentageResult[0];

	const isPausedResult = await queryContract(env, contractId, ltlIface, 'isPaused', [], operatorId);
	const isPaused = isPausedResult[0];

	// Lottery Statistics
	const lottoStats = await queryContract(env, contractId, ltlIface, 'getLottoStats', [], operatorId);

	// Process statistics
	const jackpotPool = Number(lottoStats[0]) / (10 ** lazyTokenDecimals);
	const jackpotsWon = Number(lottoStats[1]);
	const jackpotPaid = Number(lottoStats[2]) / (10 ** lazyTokenDecimals);
	const totalRolls = Number(lottoStats[3]);
	const totalWins = Number(lottoStats[4]);
	const totalPaid = Number(lottoStats[5]) / (10 ** lazyTokenDecimals);
	const lossIncrement = Number(lottoStats[6]) / (10 ** lazyTokenDecimals);
	const maxJackpotThreshold = Number(lottoStats[7]) / (10 ** lazyTokenDecimals);

	// Build result object
	const result = {
		success: true,
		data: {
			contract: contractId.toString(),
			status: isPaused ? 'paused' : 'active',
			burnPercentage: Number(burnPercentage),
			systemWallet: systemWallet,
			lshTokens: {
				gen1: TokenId.fromSolidityAddress(lshGen1).toString(),
				gen2: TokenId.fromSolidityAddress(lshGen2).toString(),
				gen1Mutant: TokenId.fromSolidityAddress(lshMutant).toString(),
			},
			connectedContracts: {
				prng: ContractId.fromSolidityAddress(prngContract).toString(),
				lazyGasStation: ContractId.fromSolidityAddress(lgsContract).toString(),
				lazyDelegateRegistry: ContractId.fromSolidityAddress(ldrContract).toString(),
			},
			statistics: {
				jackpot: jackpotPool,
				maxJackpotCap: maxJackpotThreshold,
				perRollIncrement: lossIncrement,
				jackpotsWon: jackpotsWon,
				jackpotPaid: jackpotPaid,
				totalRolls: totalRolls,
				totalWins: totalWins,
				winRate: totalRolls > 0 ? ((totalWins / totalRolls) * 100).toFixed(2) : null,
				totalPaid: totalPaid,
				combinedPayouts: totalPaid + jackpotPaid,
			},
		},
		metadata: {
			environment: env,
			timestamp: new Date().toISOString(),
			lazyDecimals: lazyTokenDecimals,
		},
	};

	// Output based on format
	if (outputJson) {
		console.log(JSON.stringify(result, null, 2));
	}
	else {
		// Display Results
		console.log('═══════════════════════════════════════════════════════════');
		console.log('         LazyTradeLotto Contract Information');
		console.log('═══════════════════════════════════════════════════════════\n');

		console.log('Contract Address:', contractId.toString());
		console.log('Status:', isPaused ? 'PAUSED' : 'ACTIVE');
		console.log('Burn Percentage:', Number(burnPercentage) + '%');
		console.log('System Wallet:', systemWallet);

		console.log('\n───────────────────────────────────────────────────────────');
		console.log('  LSH NFT Collections (0% Burn for Holders)');
		console.log('───────────────────────────────────────────────────────────\n');

		console.log('LSH Gen1:', TokenId.fromSolidityAddress(lshGen1).toString());
		console.log('LSH Gen2:', TokenId.fromSolidityAddress(lshGen2).toString());
		console.log('LSH Gen1 Mutant:', TokenId.fromSolidityAddress(lshMutant).toString());

		console.log('\n───────────────────────────────────────────────────────────');
		console.log('  Connected Contracts');
		console.log('───────────────────────────────────────────────────────────\n');

		console.log('PRNG System:', ContractId.fromSolidityAddress(prngContract).toString());
		console.log('Lazy Gas Station:', ContractId.fromSolidityAddress(lgsContract).toString());
		console.log('Lazy Delegate Registry:', ContractId.fromSolidityAddress(ldrContract).toString());

		console.log('\n───────────────────────────────────────────────────────────');
		console.log('  Jackpot & Statistics');
		console.log('───────────────────────────────────────────────────────────\n');

		console.log('Current Jackpot:', jackpotPool.toLocaleString(), '$LAZY');
		console.log('Max Jackpot Cap:', maxJackpotThreshold.toLocaleString(), '$LAZY');
		console.log('Per-Roll Increment:', lossIncrement.toLocaleString(), '$LAZY');

		console.log('\nJackpot History:');
		console.log('   Wins:', jackpotsWon);
		console.log('   Total Paid:', jackpotPaid.toLocaleString(), '$LAZY');

		console.log('\nRegular Wins:');
		console.log('   Total Rolls:', totalRolls.toLocaleString());
		console.log('   Total Wins:', totalWins.toLocaleString());
		console.log('   Win Rate:', totalRolls > 0 ? ((totalWins / totalRolls) * 100).toFixed(2) + '%' : 'N/A');
		console.log('   Total Paid:', totalPaid.toLocaleString(), '$LAZY');

		console.log('\nCombined Payouts:', (totalPaid + jackpotPaid).toLocaleString(), '$LAZY');

		console.log('\n═══════════════════════════════════════════════════════════\n');
	}
}

main()
	.then(() => process.exit(0))
	.catch(error => {
		console.error(error);
		process.exit(1);
	});
