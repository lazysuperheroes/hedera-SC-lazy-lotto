/**
 * LazyLotto Pool Details
 *
 * Shows comprehensive information for a specific pool:
 * - Basic info (name, owner, type)
 * - Financial details (proceeds, platform fee %)
 * - Prize manager
 *
 * Usage: node scripts/interactions/LazyLotto/queries/poolDetails.js [poolId]
 *        If poolId not provided, will prompt for input
 */

require('dotenv').config();
const {
	Hbar,
	HbarUnit,
} = require('@hashgraph/sdk');
const { createClient, getEnvConfig, getContractId } = require('../../../../utils/clientFactory');
const { loadInterface } = require('../../../../utils/abiLoader');
const { queryContract } = require('../../../../utils/queryHelpers');
const { prompt } = require('../../../../utils/promptHelpers');

const { homebrewPopulateAccountNum, EntityType } = require('../../../../utils/hederaMirrorHelpers');

// Environment setup
const { operatorId, operatorKey, env } = getEnvConfig();
const poolManagerId = getContractId('LAZY_LOTTO_POOL_MANAGER_ID');
const lazyLottoId = getContractId('LAZY_LOTTO_CONTRACT_ID');

async function convertToHederaId(evmAddress) {
	if (!evmAddress.startsWith('0x')) return evmAddress;
	return await homebrewPopulateAccountNum(env, evmAddress, EntityType.ACCOUNT);
}

async function getPoolDetails(poolId) {
	let client;

	try {
		// Initialize client
		client = createClient(env, operatorId, operatorKey);

		console.log('\n╔════════════════════════════════════════════════════════════╗');
		console.log('║                 LazyLotto Pool Details                    ║');
		console.log('╚════════════════════════════════════════════════════════════╝\n');
		console.log(`📍 Environment: ${env.toUpperCase()}`);
		console.log(`📄 Pool Manager: ${poolManagerId.toString()}`);
		console.log(`📄 LazyLotto: ${lazyLottoId.toString()}`);
		console.log(`👤 Querying as: ${operatorId.toString()}\n`);

		// Load interfaces
		const poolManagerIface = loadInterface('LazyLottoPoolManager');
		const lazyLottoIface = loadInterface('LazyLotto');

		// === BASIC INFO ===
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
		console.log(`🎱 Pool #${poolId} - Basic Information`);
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

		// Get pool info from LazyLotto
		const poolInfo = await queryContract(env, lazyLottoId, lazyLottoIface, 'getPoolBasicInfo', [poolId], operatorId);
		const ticketCID = poolInfo[0];
		const winCID = poolInfo[1];
		const feeToken = poolInfo[9];

		console.log(`   Ticket CID: "${ticketCID}"`);
		console.log(`   Win CID: "${winCID}"`);

		// Check if global pool
		const isGlobal = await queryContract(env, poolManagerId, poolManagerIface, 'isGlobalPool', [poolId], operatorId);

		console.log(`   Type: ${isGlobal[0] ? 'Global (Admin-Created)' : 'Community (User-Created)'}\n`);

		// === OWNERSHIP ===
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
		console.log('👤 Ownership & Management');
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

		const owner = await queryContract(env, poolManagerId, poolManagerIface, 'getPoolOwner', [poolId], operatorId);
		const ownerHederaId = await convertToHederaId(owner[0]);

		console.log(`   Owner: ${ownerHederaId}`);

		// Get prize manager
		const prizeManager = await queryContract(env, poolManagerId, poolManagerIface, 'getPoolPrizeManager', [poolId], operatorId);
		const prizeManagerHederaId = prizeManager[0] && prizeManager[0] !== '0x0000000000000000000000000000000000000000'
			? await convertToHederaId(prizeManager[0])
			: 'Not Set';

		console.log(`   Prize Manager: ${prizeManagerHederaId}\n`);

		// === FINANCIALS ===
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
		console.log('💰 Financial Details');
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

		// Get platform fee percentage
		const feePercent = await queryContract(env, poolManagerId, poolManagerIface, 'getPoolPlatformFeePercentage', [poolId], operatorId);
		const platformPercent = Number(feePercent[0]);
		const ownerPercent = 100 - platformPercent;

		console.log(`   Platform Fee: ${platformPercent}%`);
		console.log(`   Pool Owner Share: ${ownerPercent}%\n`);

		// Get pool proceeds (pass feeToken from getPoolBasicInfo result index [9])
		const proceeds = await queryContract(env, poolManagerId, poolManagerIface, 'getPoolProceeds', [poolId, feeToken], operatorId);

		const totalProceeds = proceeds[0];
		const withdrawn = proceeds[1];
		const available = totalProceeds - withdrawn;

		console.log('   Pool Proceeds:');
		console.log(`      Total Earned: ${new Hbar(totalProceeds, HbarUnit.Tinybar).toString()}`);
		console.log(`      Withdrawn: ${new Hbar(withdrawn, HbarUnit.Tinybar).toString()}`);
		console.log(`      Available: ${new Hbar(available, HbarUnit.Tinybar).toString()}\n`);

		// Calculate splits
		const platformShare = (Number(available) * platformPercent) / 100;
		const ownerShare = Number(available) - platformShare;

		console.log('   Available Breakdown:');
		console.log(`      Platform (${platformPercent}%): ${new Hbar(platformShare, HbarUnit.Tinybar).toString()}`);
		console.log(`      Pool Owner (${ownerPercent}%): ${new Hbar(ownerShare, HbarUnit.Tinybar).toString()}\n`);

		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

		if (available > 0n && ownerHederaId === operatorId.toString()) {
			console.log('💡 You own this pool and have withdrawable proceeds!');
			console.log('   Run: node scripts/interactions/LazyLotto/user/withdrawPoolProceeds.js\n');
		}

	}
	catch (error) {
		console.error('\n❌ Error getting pool details:');
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

async function main() {
	// Check for command line argument
	let poolId = process.argv[2];

	// If not provided, prompt
	if (!poolId) {
		poolId = await prompt('Enter Pool ID: ');
	}

	poolId = parseInt(poolId);

	if (isNaN(poolId) || poolId < 0) {
		console.error('❌ Invalid pool ID. Must be a non-negative integer.');
		process.exit(1);
	}

	await getPoolDetails(poolId);
}

// Run the script
main();
