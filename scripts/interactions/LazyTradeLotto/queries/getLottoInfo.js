/**
 * LazyTradeLotto - Get Complete Lottery Information
 *
 * Displays comprehensive information about the LazyTradeLotto contract:
 * - Connected contracts (PRNG, LazyGasStation)
 * - Configuration (systemWallet, burnPercentage, pause status)
 * - v2 safety limits (max win cap, 24h payout window, codeless-caller requirement)
 * - Lottery statistics (jackpot, wins, payouts, etc.)
 * Pre-v2 contracts also show their on-chain LSH collections and LazyDelegateRegistry.
 *
 * Usage: node queries/getLottoInfo.js <contractId> [--json]
 * Example: node queries/getLottoInfo.js 0.0.123456
 *
 * Options:
 *   --json    Output results as JSON (for programmatic use)
 */

require('dotenv').config();
const { ethers } = require('ethers');
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

	// getters that only exist on one contract version resolve to null on the other
	const tryQuery = async (fn, iface = ltlIface) => {
		try {
			return await queryContract(env, contractId, iface, fn, [], operatorId);
		}
		catch {
			return null;
		}
	};
	// pre-v2 only: on-chain LSH exemption lookups (v2 signs the exemption per roll)
	const v1Iface = new ethers.Interface([
		'function LSH_GEN1() view returns (address)',
		'function LSH_GEN2() view returns (address)',
		'function LSH_GEN1_MUTANT() view returns (address)',
		'function lazyDelegateRegistry() view returns (address)',
	]);
	const lshGen1 = (await tryQuery('LSH_GEN1', v1Iface))?.[0] ?? null;
	const lshGen2 = (await tryQuery('LSH_GEN2', v1Iface))?.[0] ?? null;
	const lshMutant = (await tryQuery('LSH_GEN1_MUTANT', v1Iface))?.[0] ?? null;
	const ldrContract = (await tryQuery('lazyDelegateRegistry', v1Iface))?.[0] ?? null;

	// Connected Contracts
	const prngResult = await queryContract(env, contractId, ltlIface, 'prngSystemContract', [], operatorId);
	const prngContract = prngResult[0];

	const lgsResult = await queryContract(env, contractId, ltlIface, 'lazyGasStation', [], operatorId);
	const lgsContract = lgsResult[0];


	// Configuration
	const systemWalletResult = await queryContract(env, contractId, ltlIface, 'systemWallet', [], operatorId);
	const systemWallet = systemWalletResult[0];

	const burnPercentageResult = await queryContract(env, contractId, ltlIface, 'burnPercentage', [], operatorId);
	const burnPercentage = burnPercentageResult[0];

	const isPausedResult = await queryContract(env, contractId, ltlIface, 'isPaused', [], operatorId);
	const isPaused = isPausedResult[0];

	// v2 only: payout limits and caller policy (pre-v2 contracts have no such getters)
	const maxWinCapResult = await tryQuery('maxWinAmtCap');
	const maxWinCap = maxWinCapResult ? Number(maxWinCapResult[0]) / (10 ** lazyTokenDecimals) : null;
	const windowResult = await tryQuery('getPayoutWindow');
	const payoutWindow = windowResult ? {
		paid: Number(windowResult[1]) / (10 ** lazyTokenDecimals),
		cap: Number(windowResult[2]) / (10 ** lazyTokenDecimals),
		remaining: Number(windowResult[3]) / (10 ** lazyTokenDecimals),
	} : null;
	const codelessResult = await tryQuery('requireCodelessCaller');
	const requireCodelessCaller = codelessResult ? codelessResult[0] : null;

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
			maxWinCap: maxWinCap,
			payoutWindow: payoutWindow,
			requireCodelessCaller: requireCodelessCaller,
			systemWallet: systemWallet,
			lshTokens: lshGen1 ? {
				gen1: TokenId.fromSolidityAddress(lshGen1).toString(),
				gen2: TokenId.fromSolidityAddress(lshGen2).toString(),
				gen1Mutant: TokenId.fromSolidityAddress(lshMutant).toString(),
			} : null,
			connectedContracts: {
				prng: ContractId.fromSolidityAddress(prngContract).toString(),
				lazyGasStation: ContractId.fromSolidityAddress(lgsContract).toString(),
				lazyDelegateRegistry: ldrContract ? ContractId.fromSolidityAddress(ldrContract).toString() : null,
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

		if (maxWinCap !== null) {
			console.log('\n───────────────────────────────────────────────────────────');
			console.log('  Payout Limits & Caller Policy (v2)');
			console.log('───────────────────────────────────────────────────────────\n');

			console.log('Max Win Cap (per roll):', maxWinCap.toLocaleString(), '$LAZY');
			console.log('Payout Window Cap (24h):', payoutWindow.cap.toLocaleString(), '$LAZY');
			console.log('   Paid in current window:', payoutWindow.paid.toLocaleString(), '$LAZY');
			console.log('   Remaining:', payoutWindow.remaining.toLocaleString(), '$LAZY');
			console.log('Require codeless caller (HIP-1340):', requireCodelessCaller ? 'ON' : 'off');
			console.log('Burn exemption: signed per roll by the system wallet (LSH holder / valid delegate)');
		}

		if (lshGen1) {
			console.log('\n───────────────────────────────────────────────────────────');
			console.log('  LSH NFT Collections (pre-v2: on-chain 0% burn lookup)');
			console.log('───────────────────────────────────────────────────────────\n');

			console.log('LSH Gen1:', TokenId.fromSolidityAddress(lshGen1).toString());
			console.log('LSH Gen2:', TokenId.fromSolidityAddress(lshGen2).toString());
			console.log('LSH Gen1 Mutant:', TokenId.fromSolidityAddress(lshMutant).toString());
		}

		console.log('\n───────────────────────────────────────────────────────────');
		console.log('  Connected Contracts');
		console.log('───────────────────────────────────────────────────────────\n');

		console.log('PRNG System:', ContractId.fromSolidityAddress(prngContract).toString());
		console.log('Lazy Gas Station:', ContractId.fromSolidityAddress(lgsContract).toString());
		if (ldrContract) console.log('Lazy Delegate Registry:', ContractId.fromSolidityAddress(ldrContract).toString());

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
