/**
 * LazyLotto System Health Check
 *
 * Quick system status check for all LazyLotto ecosystem contracts.
 * Queries contract state via mirror node (free, no gas cost).
 *
 * Checks:
 * - LazyLotto: paused status, pool count, outstanding entries
 * - LazyTradeLotto: paused status, jackpot, total rolls/wins
 * - LazyGasStation: LAZY balance, HBAR balance
 * - LazyDelegateRegistry: delegation count
 *
 * Usage: node scripts/interactions/healthCheck.js [--json]
 *
 * Options:
 *   --json    Output results as JSON (for programmatic use)
 */

const {
	AccountId,
	ContractId,
	TokenId,
	Hbar,
	HbarUnit,
} = require('@hashgraph/sdk');
require('dotenv').config();

const { getBaseURL, checkMirrorHbarBalance, checkMirrorBalance } = require('../../utils/hederaMirrorHelpers');
const axios = require('axios');
const { loadInterface } = require('../../utils/abiLoader');
const { queryContract } = require('../../utils/queryHelpers');

// Environment setup
const env = process.env.ENVIRONMENT ?? 'testnet';
const operatorId = process.env.ACCOUNT_ID ? AccountId.fromString(process.env.ACCOUNT_ID) : null;
const outputJson = process.argv.includes('--json');

// Contract IDs from .env (all optional)
const lazyLottoId = process.env.LAZY_LOTTO_CONTRACT_ID ? ContractId.fromString(process.env.LAZY_LOTTO_CONTRACT_ID) : null;
const lazyTradeLottoId = process.env.LAZY_TRADE_LOTTO_CONTRACT_ID ? ContractId.fromString(process.env.LAZY_TRADE_LOTTO_CONTRACT_ID) : null;
const lazyGasStationId = process.env.LAZY_GAS_STATION_CONTRACT_ID ? ContractId.fromString(process.env.LAZY_GAS_STATION_CONTRACT_ID) : null;
const lazyDelegateRegistryId = process.env.LAZY_DELEGATE_REGISTRY_CONTRACT_ID ? ContractId.fromString(process.env.LAZY_DELEGATE_REGISTRY_CONTRACT_ID) : null;
const lazyTokenId = process.env.LAZY_TOKEN_ID ? TokenId.fromString(process.env.LAZY_TOKEN_ID) : null;
const lazyDecimals = parseInt(process.env.LAZY_DECIMALS ?? '1');

/**
 * Check if a contract exists on the mirror node
 */
async function contractExists(contractId) {
	try {
		const baseUrl = getBaseURL(env);
		const response = await axios.get(`${baseUrl}/api/v1/contracts/${contractId.toString()}`);
		return response.status === 200;
	}
	catch {
		return false;
	}
}

/**
 * Query LazyLotto contract status
 */
async function checkLazyLotto(iface) {
	const result = {
		configured: !!lazyLottoId,
		contractId: lazyLottoId?.toString() || null,
		status: 'not_configured',
		details: {},
	};

	if (!lazyLottoId) return result;

	try {
		// Check contract exists
		if (!await contractExists(lazyLottoId)) {
			result.status = 'not_found';
			return result;
		}

		// Check paused status
		const pausedResult = await queryContract(env, lazyLottoId, iface, 'paused', [], operatorId);
		const isPaused = pausedResult[0];

		// Get total pools
		const poolsResult = await queryContract(env, lazyLottoId, iface, 'totalPools', [], operatorId);
		const totalPools = Number(poolsResult[0]);

		// Count outstanding entries across all pools
		let totalOutstanding = 0;
		let activePools = 0;
		let pausedPools = 0;
		let closedPools = 0;

		for (let i = 0; i < totalPools; i++) {
			const poolInfo = await queryContract(env, lazyLottoId, iface, 'getPoolBasicInfo', [i], operatorId);
			// [ticketCID, winCID, winRate, entryFee, prizeCount, outstandingEntries, poolTokenId, paused, closed, feeToken]
			const outstandingEntries = Number(poolInfo[5]);
			const poolPaused = poolInfo[7];
			const poolClosed = poolInfo[8];

			totalOutstanding += outstandingEntries;

			if (poolClosed) {
				closedPools++;
			}
			else if (poolPaused) {
				pausedPools++;
			}
			else {
				activePools++;
			}
		}

		result.status = isPaused ? 'paused' : 'operational';
		result.details = {
			paused: isPaused,
			totalPools,
			activePools,
			pausedPools,
			closedPools,
			outstandingEntries: totalOutstanding,
		};
	}
	catch (error) {
		result.status = 'error';
		result.error = error.message;
	}

	return result;
}

/**
 * Query LazyTradeLotto contract status
 */
async function checkLazyTradeLotto(iface) {
	const result = {
		configured: !!lazyTradeLottoId,
		contractId: lazyTradeLottoId?.toString() || null,
		status: 'not_configured',
		details: {},
	};

	if (!lazyTradeLottoId) return result;

	try {
		// Check contract exists
		if (!await contractExists(lazyTradeLottoId)) {
			result.status = 'not_found';
			return result;
		}

		// Check paused status
		const pausedResult = await queryContract(env, lazyTradeLottoId, iface, 'paused', [], operatorId);
		const isPaused = pausedResult[0];

		// Get jackpot
		const jackpotResult = await queryContract(env, lazyTradeLottoId, iface, 'jackpotPool', [], operatorId);
		const jackpot = jackpotResult[0];
		const jackpotFormatted = Number(jackpot) / (10 ** lazyDecimals);

		// Get total rolls
		const rollsResult = await queryContract(env, lazyTradeLottoId, iface, 'totalRolls', [], operatorId);
		const totalRolls = Number(rollsResult[0]);

		// Get total wins
		const winsResult = await queryContract(env, lazyTradeLottoId, iface, 'totalWins', [], operatorId);
		const totalWins = Number(winsResult[0]);

		// Get total payout
		const payoutResult = await queryContract(env, lazyTradeLottoId, iface, 'totalPaid', [], operatorId);
		const totalPayout = payoutResult[0];
		const totalPayoutFormatted = Number(totalPayout) / (10 ** lazyDecimals);

		result.status = isPaused ? 'paused' : 'operational';
		result.details = {
			paused: isPaused,
			jackpot: jackpotFormatted,
			jackpotRaw: jackpot.toString(),
			totalRolls,
			totalWins,
			winRate: totalRolls > 0 ? ((totalWins / totalRolls) * 100).toFixed(2) + '%' : 'N/A',
			totalPayout: totalPayoutFormatted,
		};
	}
	catch (error) {
		result.status = 'error';
		result.error = error.message;
	}

	return result;
}

/**
 * Query LazyGasStation contract status
 */
async function checkLazyGasStation() {
	const result = {
		configured: !!lazyGasStationId,
		contractId: lazyGasStationId?.toString() || null,
		status: 'not_configured',
		details: {},
	};

	if (!lazyGasStationId) return result;

	try {
		// Check contract exists
		if (!await contractExists(lazyGasStationId)) {
			result.status = 'not_found';
			return result;
		}

		// Get HBAR balance from mirror node
		const hbarBalance = await checkMirrorHbarBalance(env, lazyGasStationId.toString()) || 0;
		const hbarFormatted = new Hbar(hbarBalance, HbarUnit.Tinybar);

		let lazyBalance = 0;
		let lazyFormatted = 0;

		// Get LAZY token balance
		if (lazyTokenId) {
			const tokenBalance = await checkMirrorBalance(env, lazyGasStationId.toString(), lazyTokenId.toString());
			if (tokenBalance !== null) {
				lazyBalance = tokenBalance;
				lazyFormatted = lazyBalance / (10 ** lazyDecimals);
			}
		}

		// Determine health status based on balances
		// < 10 HBAR
		const lowHbar = hbarBalance < 10_00000000;
		// < 1000 LAZY
		const lowLazy = lazyBalance < 1000 * (10 ** lazyDecimals);

		result.status = (lowHbar || lowLazy) ? 'low_balance' : 'operational';
		result.details = {
			hbarBalance: hbarFormatted.toString(),
			hbarTinybar: hbarBalance,
			lazyBalance: lazyFormatted,
			lazyRaw: lazyBalance,
			warnings: [],
		};

		if (lowHbar) {
			result.details.warnings.push('Low HBAR balance (< 10 HBAR)');
		}
		if (lowLazy) {
			result.details.warnings.push('Low LAZY balance (< 1000 LAZY)');
		}
	}
	catch (error) {
		result.status = 'error';
		result.error = error.message;
	}

	return result;
}

/**
 * Query LazyDelegateRegistry contract status
 */
async function checkLazyDelegateRegistry(iface) {
	const result = {
		configured: !!lazyDelegateRegistryId,
		contractId: lazyDelegateRegistryId?.toString() || null,
		status: 'not_configured',
		details: {},
	};

	if (!lazyDelegateRegistryId) return result;

	try {
		// Check contract exists
		if (!await contractExists(lazyDelegateRegistryId)) {
			result.status = 'not_found';
			return result;
		}

		// Get total delegations
		const delegationResult = await queryContract(env, lazyDelegateRegistryId, iface, 'totalSerialsDelegated', [], operatorId);
		const totalDelegations = Number(delegationResult[0]);

		result.status = 'operational';
		result.details = {
			totalDelegations,
		};
	}
	catch (error) {
		result.status = 'error';
		result.error = error.message;
	}

	return result;
}

/**
 * Format status for console output
 */
function formatStatus(status) {
	switch (status) {
	case 'operational':
		return '🟢 Operational';
	case 'paused':
		return '⏸️  Paused';
	case 'low_balance':
		return '⚠️  Low Balance';
	case 'not_configured':
		return '⚪ Not Configured';
	case 'not_found':
		return '🔴 Not Found';
	case 'error':
		return '🔴 Error';
	default:
		return '❓ Unknown';
	}
}

/**
 * Main health check function
 */
async function runHealthCheck() {
	const timestamp = new Date().toISOString();

	// Validation
	if (!operatorId) {
		console.error('ERROR: ACCOUNT_ID must be set in .env');
		process.exit(1);
	}

	// Load ABIs
	let lazyLottoIface = null;
	let lazyTradeLottoIface = null;
	let lazyDelegateRegistryIface = null;

	try {
		if (lazyLottoId) {
			lazyLottoIface = loadInterface('LazyLotto');
		}
	}
	catch {
		// ABI not found, will be handled by check function
	}

	try {
		if (lazyTradeLottoId) {
			lazyTradeLottoIface = loadInterface('LazyTradeLotto');
		}
	}
	catch {
		// ABI not found, will be handled by check function
	}

	try {
		if (lazyDelegateRegistryId) {
			lazyDelegateRegistryIface = loadInterface('LazyDelegateRegistry');
		}
	}
	catch {
		// ABI not found, will be handled by check function
	}

	// Run all checks
	const [lazyLotto, lazyTradeLotto, lazyGasStation, lazyDelegateRegistry] = await Promise.all([
		lazyLottoIface ? checkLazyLotto(lazyLottoIface) : { configured: false, status: 'not_configured', details: {} },
		lazyTradeLottoIface ? checkLazyTradeLotto(lazyTradeLottoIface) : { configured: false, status: 'not_configured', details: {} },
		checkLazyGasStation(),
		lazyDelegateRegistryIface ? checkLazyDelegateRegistry(lazyDelegateRegistryIface) : { configured: false, status: 'not_configured', details: {} },
	]);

	// Build result object
	const result = {
		success: true,
		timestamp,
		environment: env.toUpperCase(),
		contracts: {
			lazyLotto,
			lazyTradeLotto,
			lazyGasStation,
			lazyDelegateRegistry,
		},
		summary: {
			configured: [lazyLotto, lazyTradeLotto, lazyGasStation, lazyDelegateRegistry].filter(c => c.configured).length,
			operational: [lazyLotto, lazyTradeLotto, lazyGasStation, lazyDelegateRegistry].filter(c => c.status === 'operational').length,
			warnings: [lazyLotto, lazyTradeLotto, lazyGasStation, lazyDelegateRegistry].filter(c => c.status === 'low_balance' || c.status === 'paused').length,
			errors: [lazyLotto, lazyTradeLotto, lazyGasStation, lazyDelegateRegistry].filter(c => c.status === 'error' || c.status === 'not_found').length,
		},
	};

	// Output
	if (outputJson) {
		console.log(JSON.stringify(result, null, 2));
	}
	else {
		console.log('\n╔════════════════════════════════════════════════════════════╗');
		console.log('║            LazyLotto System Health Check                  ║');
		console.log('╚════════════════════════════════════════════════════════════╝\n');
		console.log(`📍 Environment: ${env.toUpperCase()}`);
		console.log(`🕐 Timestamp:   ${timestamp}\n`);

		console.log('═══════════════════════════════════════════════════════════');
		console.log('  CONTRACT STATUS');
		console.log('═══════════════════════════════════════════════════════════\n');

		// LazyLotto
		console.log(`LazyLotto:              ${formatStatus(lazyLotto.status)}`);
		if (lazyLotto.contractId) {
			console.log(`  Contract ID:          ${lazyLotto.contractId}`);
		}
		if (lazyLotto.status === 'operational' || lazyLotto.status === 'paused') {
			console.log(`  Total Pools:          ${lazyLotto.details.totalPools} (${lazyLotto.details.activePools} active, ${lazyLotto.details.pausedPools} paused, ${lazyLotto.details.closedPools} closed)`);
			console.log(`  Outstanding Entries:  ${lazyLotto.details.outstandingEntries}`);
		}
		if (lazyLotto.error) {
			console.log(`  Error:                ${lazyLotto.error}`);
		}
		console.log();

		// LazyTradeLotto
		console.log(`LazyTradeLotto:         ${formatStatus(lazyTradeLotto.status)}`);
		if (lazyTradeLotto.contractId) {
			console.log(`  Contract ID:          ${lazyTradeLotto.contractId}`);
		}
		if (lazyTradeLotto.status === 'operational' || lazyTradeLotto.status === 'paused') {
			console.log(`  Jackpot:              ${lazyTradeLotto.details.jackpot.toLocaleString()} LAZY`);
			console.log(`  Total Rolls:          ${lazyTradeLotto.details.totalRolls.toLocaleString()}`);
			console.log(`  Total Wins:           ${lazyTradeLotto.details.totalWins.toLocaleString()} (${lazyTradeLotto.details.winRate})`);
			console.log(`  Total Payout:         ${lazyTradeLotto.details.totalPayout.toLocaleString()} LAZY`);
		}
		if (lazyTradeLotto.error) {
			console.log(`  Error:                ${lazyTradeLotto.error}`);
		}
		console.log();

		// LazyGasStation
		console.log(`LazyGasStation:         ${formatStatus(lazyGasStation.status)}`);
		if (lazyGasStation.contractId) {
			console.log(`  Contract ID:          ${lazyGasStation.contractId}`);
		}
		if (lazyGasStation.status === 'operational' || lazyGasStation.status === 'low_balance') {
			console.log(`  HBAR Balance:         ${lazyGasStation.details.hbarBalance}`);
			console.log(`  LAZY Balance:         ${lazyGasStation.details.lazyBalance.toLocaleString()} LAZY`);
			if (lazyGasStation.details.warnings && lazyGasStation.details.warnings.length > 0) {
				lazyGasStation.details.warnings.forEach(w => console.log(`  ⚠️  ${w}`));
			}
		}
		if (lazyGasStation.error) {
			console.log(`  Error:                ${lazyGasStation.error}`);
		}
		console.log();

		// LazyDelegateRegistry
		console.log(`LazyDelegateRegistry:   ${formatStatus(lazyDelegateRegistry.status)}`);
		if (lazyDelegateRegistry.contractId) {
			console.log(`  Contract ID:          ${lazyDelegateRegistry.contractId}`);
		}
		if (lazyDelegateRegistry.status === 'operational') {
			console.log(`  Total Delegations:    ${lazyDelegateRegistry.details.totalDelegations}`);
		}
		if (lazyDelegateRegistry.error) {
			console.log(`  Error:                ${lazyDelegateRegistry.error}`);
		}
		console.log();

		// Summary
		console.log('═══════════════════════════════════════════════════════════');
		console.log('  SUMMARY');
		console.log('═══════════════════════════════════════════════════════════');
		console.log(`  Contracts Configured: ${result.summary.configured}/4`);
		console.log(`  Operational:          ${result.summary.operational}`);
		console.log(`  Warnings:             ${result.summary.warnings}`);
		console.log(`  Errors:               ${result.summary.errors}`);
		console.log('═══════════════════════════════════════════════════════════\n');

		if (result.summary.errors > 0) {
			console.log('❌ System has errors - check configuration and contract addresses\n');
		}
		else if (result.summary.warnings > 0) {
			console.log('⚠️  System has warnings - some contracts may need attention\n');
		}
		else if (result.summary.operational > 0) {
			console.log('✅ System is healthy!\n');
		}
		else {
			console.log('⚪ No contracts configured - set contract IDs in .env\n');
		}
	}
}

runHealthCheck()
	.then(() => process.exit(0))
	.catch((error) => {
		if (outputJson) {
			console.log(JSON.stringify({ success: false, error: error.message }, null, 2));
		}
		else {
			console.error('Unexpected error:', error);
		}
		process.exit(1);
	});
