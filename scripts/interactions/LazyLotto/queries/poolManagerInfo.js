/**
 * LazyLottoPoolManager Information Query
 *
 * Displays comprehensive pool manager state:
 * - Creation fees (HBAR and LAZY)
 * - Platform proceeds percentage
 * - Time-based bonuses
 * - NFT holding bonuses
 * - LAZY balance bonus
 * - Global and community pool counts
 *
 * Usage: node scripts/interactions/LazyLotto/queries/poolManagerInfo.js
 */

require('dotenv').config();
const {
	Hbar,
	HbarUnit,
} = require('@hashgraph/sdk');
const { createClient, getEnvConfig, getContractId } = require('../../../../utils/clientFactory');
const { loadInterface } = require('../../../../utils/abiLoader');
const { queryContract } = require('../../../../utils/queryHelpers');

// Environment setup
const { operatorId, operatorKey, env } = getEnvConfig();
const poolManagerId = getContractId('LAZY_LOTTO_POOL_MANAGER_ID');
const lazyDecimals = parseInt(process.env.LAZY_DECIMALS ?? '1');

async function getPoolManagerInfo() {
	let client;

	try {
		// Initialize client
		client = createClient(env, operatorId, operatorKey);

		console.log('\n╔════════════════════════════════════════════════════════════╗');
		console.log('║        LazyLottoPoolManager Information Query             ║');
		console.log('╚════════════════════════════════════════════════════════════╝\n');
		console.log(`📍 Environment: ${env.toUpperCase()}`);
		console.log(`📄 Pool Manager: ${poolManagerId.toString()}`);
		console.log(`👤 Querying as: ${operatorId.toString()}\n`);

		// Load interface
		const poolManagerIface = loadInterface('LazyLottoPoolManager');

		// === CREATION FEES ===
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
		console.log('💰 CREATION FEES (for community pools)');
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

		const fees = await queryContract(env, poolManagerId, poolManagerIface, 'getCreationFees', [], operatorId);

		const hbarFee = Number(fees[0]);
		const lazyFee = Number(fees[1]);
		const hbarDisplay = new Hbar(hbarFee, HbarUnit.Tinybar).toString();
		const lazyDisplay = (lazyFee / (10 ** lazyDecimals)).toFixed(lazyDecimals);

		console.log(`   HBAR Fee: ${hbarDisplay} (${hbarFee.toLocaleString()} tinybars)`);
		console.log(`   LAZY Fee: ${lazyDisplay} LAZY (${lazyFee.toLocaleString()} units)\n`);

		// === PLATFORM FEE ===
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
		console.log('🏦 PLATFORM FEE CONFIGURATION');
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

		const platformFee = await queryContract(env, poolManagerId, poolManagerIface, 'platformProceedsPercentage', [], operatorId);

		console.log(`   Platform Proceeds: ${platformFee[0]}% of pool entry fees`);
		console.log(`   Pool Owner Gets: ${100 - Number(platformFee[0])}% of pool entry fees\n`);

		// === TIME BONUSES ===
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
		console.log('⏰ TIME-BASED BONUSES');
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

		const totalTimeBonuses = await queryContract(env, poolManagerId, poolManagerIface, 'totalTimeBonuses', [], operatorId);

		if (Number(totalTimeBonuses[0]) === 0) {
			console.log('   ⚠️  No time bonuses configured\n');
		}
		else {
			console.log(`   Total Configured: ${totalTimeBonuses[0]} time bonus(es)\n`);
			// Note: Individual time bonus details require indexed access which isn't exposed
			// Users can see the effect via calculateBoost()
		}

		// === NFT BONUSES ===
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
		console.log('🎨 NFT HOLDING BONUSES');
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

		const totalNFTBonuses = await queryContract(env, poolManagerId, poolManagerIface, 'totalNFTBonusTokens', [], operatorId);

		if (Number(totalNFTBonuses[0]) === 0) {
			console.log('   ⚠️  No NFT bonuses configured\n');
		}
		else {
			console.log(`   Total Configured: ${totalNFTBonuses[0]} NFT collection(s)\n`);
			// Note: Individual NFT bonus details require indexed access
		}

		// === LAZY BALANCE BONUS ===
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
		console.log('💎 LAZY BALANCE BONUS');
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

		const threshold = await queryContract(env, poolManagerId, poolManagerIface, 'lazyBalanceThreshold', [], operatorId);
		const bonusBps = await queryContract(env, poolManagerId, poolManagerIface, 'lazyBalanceBonusBps', [], operatorId);

		if (Number(threshold[0]) === 0 || Number(bonusBps[0]) === 0) {
			console.log('   ⚠️  No LAZY balance bonus configured\n');
		}
		else {
			const thresholdDisplay = (Number(threshold[0]) / (10 ** lazyDecimals)).toFixed(lazyDecimals);
			const bonusPercent = ((Number(bonusBps[0]) - 100) / 100).toFixed(2);
			console.log(`   Threshold: ${thresholdDisplay} LAZY`);
			console.log(`   Bonus: ${bonusPercent}% (${bonusBps[0]} bps)\n`);
		}

		// === POOL STATISTICS ===
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
		console.log('📊 POOL STATISTICS');
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

		const totalGlobal = await queryContract(env, poolManagerId, poolManagerIface, 'totalGlobalPools', [], operatorId);
		const totalCommunity = await queryContract(env, poolManagerId, poolManagerIface, 'totalCommunityPools', [], operatorId);

		console.log(`   Global Pools (admin-created): ${totalGlobal[0]}`);
		console.log(`   Community Pools (user-created): ${totalCommunity[0]}`);
		console.log(`   Total Pools: ${Number(totalGlobal[0]) + Number(totalCommunity[0])}\n`);

		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
		console.log('✅ Pool Manager info query complete!\n');

	}
	catch (error) {
		console.error('\n❌ Error querying pool manager info:');
		console.error(error.message);
		if (error.stack) {
			console.error('\nStack trace:');
			console.error(error.stack);
		}
		process.exit(1);
	}
	finally {
		if (client) {
			client.close();
		}
	}
}

// Run the query
getPoolManagerInfo();
