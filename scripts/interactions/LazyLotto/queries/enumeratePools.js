/**
 * Enumerate LazyLotto Pools
 *
 * Lists all pools with categorization:
 * - Global pools (admin-created, no creation fees)
 * - Community pools (user-created, paid creation fees)
 *
 * Shows pool ID, owner, type, and platform fee percentage
 *
 * Usage: node scripts/interactions/LazyLotto/queries/enumeratePools.js [--page <number>] [--size <number>]
 */

require('dotenv').config();
const { createClient, getEnvConfig, getContractId } = require('../../../../utils/clientFactory');
const { loadInterface } = require('../../../../utils/abiLoader');
const { queryContract } = require('../../../../utils/queryHelpers');
const { convertToHederaId } = require('../../../../utils/addressHelpers');

// Environment setup
const { operatorId, operatorKey, env } = getEnvConfig();
const poolManagerId = getContractId('LAZY_LOTTO_POOL_MANAGER_ID');
const lazyLottoId = getContractId('LAZY_LOTTO_CONTRACT_ID');

// Parse command line arguments
const args = process.argv.slice(2);
let page = 0;
let pageSize = 20;

for (let i = 0; i < args.length; i++) {
	if (args[i] === '--page' && i + 1 < args.length) {
		page = parseInt(args[i + 1]);
		i++;
	}
	else if (args[i] === '--size' && i + 1 < args.length) {
		pageSize = parseInt(args[i + 1]);
		i++;
	}
}

async function enumeratePools() {
	let client;

	try {
		client = createClient(env, operatorId, operatorKey);

		console.log('\n╔════════════════════════════════════════════════════════════╗');
		console.log('║              LazyLotto Pool Enumeration                   ║');
		console.log('╚════════════════════════════════════════════════════════════╝\n');
		console.log(`📍 Environment: ${env.toUpperCase()}`);
		console.log(`📄 Pool Manager: ${poolManagerId.toString()}`);
		console.log(`👤 Querying as: ${operatorId.toString()}`);
		console.log(`📄 Page: ${page} | Size: ${pageSize}\n`);

		const poolManagerIface = loadInterface('LazyLottoPoolManager');
		const lazyLottoIface = loadInterface('LazyLotto');

		// === GLOBAL POOLS ===
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
		console.log('🌍 GLOBAL POOLS (Admin-Created)');
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

		const totalGlobal = await queryContract(env, poolManagerId, poolManagerIface, 'totalGlobalPools', [], operatorId);

		console.log(`Total Global Pools: ${totalGlobal[0]}\n`);

		if (Number(totalGlobal[0]) > 0) {
			const startIdx = page * pageSize;
			const endIdx = Math.min(startIdx + pageSize, Number(totalGlobal[0]));

			const globalPools = await queryContract(env, poolManagerId, poolManagerIface, 'getGlobalPools', [startIdx, pageSize], operatorId);
			const poolIds = globalPools[0].map(id => Number(id));

			console.log(`Showing pools ${startIdx} to ${endIdx - 1}:\n`);

			for (const poolId of poolIds) {
				const owner = await queryContract(env, poolManagerId, poolManagerIface, 'getPoolOwner', [poolId], operatorId);
				const ownerHederaId = await convertToHederaId(env, owner[0]);

				const feePercent = await queryContract(env, poolManagerId, poolManagerIface, 'getPoolPlatformFeePercentage', [poolId], operatorId);

				const poolInfo = await queryContract(env, lazyLottoId, lazyLottoIface, 'getPoolBasicInfo', [poolId], operatorId);

				console.log(`   Pool #${poolId}:`);
				console.log(`      Ticket CID: "${poolInfo[0]}"`);
				console.log('      Type: Global');
				console.log(`      Owner: ${ownerHederaId}`);
				console.log(`      Platform Fee: ${feePercent[0]}% | Pool Owner: ${100 - Number(feePercent[0])}%`);
				console.log('');
			}
		}
		else {
			console.log('   No global pools found.\n');
		}

		// === COMMUNITY POOLS ===
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
		console.log('👥 COMMUNITY POOLS (User-Created)');
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

		const totalCommunity = await queryContract(env, poolManagerId, poolManagerIface, 'totalCommunityPools', [], operatorId);

		console.log(`Total Community Pools: ${totalCommunity[0]}\n`);

		if (Number(totalCommunity[0]) > 0) {
			const startIdx = page * pageSize;
			const endIdx = Math.min(startIdx + pageSize, Number(totalCommunity[0]));

			const communityPools = await queryContract(env, poolManagerId, poolManagerIface, 'getCommunityPools', [startIdx, pageSize], operatorId);
			const poolIds = communityPools[0].map(id => Number(id));

			console.log(`Showing pools ${startIdx} to ${endIdx - 1}:\n`);

			for (const poolId of poolIds) {
				const owner = await queryContract(env, poolManagerId, poolManagerIface, 'getPoolOwner', [poolId], operatorId);
				const ownerHederaId = await convertToHederaId(env, owner[0]);

				const feePercent = await queryContract(env, poolManagerId, poolManagerIface, 'getPoolPlatformFeePercentage', [poolId], operatorId);

				const communityPoolInfo = await queryContract(env, lazyLottoId, lazyLottoIface, 'getPoolBasicInfo', [poolId], operatorId);

				console.log(`   Pool #${poolId}:`);
				console.log(`      Ticket CID: "${communityPoolInfo[0]}"`);
				console.log('      Type: Community');
				console.log(`      Owner: ${ownerHederaId}`);
				console.log(`      Platform Fee: ${feePercent[0]}% | Pool Owner: ${100 - Number(feePercent[0])}%`);
				console.log('');
			}
		}
		else {
			console.log('   No community pools found.\n');
		}

		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
		console.log(`\n💡 Total: ${Number(totalGlobal[0]) + Number(totalCommunity[0])} pools`);
		console.log('   Use --page <n> --size <s> to paginate results\n');

	}
	catch (error) {
		console.error('\n❌ Error enumerating pools:');
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

enumeratePools();
