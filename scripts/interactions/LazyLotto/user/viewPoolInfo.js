/**
 * LazyLotto View Pool Info Script (Extended)
 *
 * Shows extended pool information including ownership and proceeds (PoolManager data).
 * Use this for community pools to see ownership and financial details.
 * For basic pool info, use queries/poolInfo.js instead.
 *
 * Usage: node scripts/interactions/LazyLotto/user/view-pool-info.js --pool <poolId>
 */

require('dotenv').config();
const {
	TokenId,
	Hbar,
	HbarUnit,
} = require('@hashgraph/sdk');
const { createClient, getEnvConfig, getContractId } = require('../../../../utils/clientFactory');
const { loadInterface } = require('../../../../utils/abiLoader');
const { prompt } = require('../../../../utils/promptHelpers');
const { queryContract } = require('../../../../utils/queryHelpers');

const { homebrewPopulateAccountNum } = require('../../../../utils/hederaMirrorHelpers');

// Environment setup
const { operatorId, operatorKey, env } = getEnvConfig();
const poolManagerId = getContractId('LAZY_LOTTO_POOL_MANAGER_ID');
const lazyTokenId = process.env.LAZY_TOKEN_ID;

// Helper: Convert Hedera ID to EVM address
async function convertToHederaId(evmAddress, entityType = null) {
	if (!evmAddress.startsWith('0x')) return evmAddress;
	if (evmAddress === '0x0000000000000000000000000000000000000000') return 'HBAR';
	return await homebrewPopulateAccountNum(env, evmAddress, entityType);
}

async function viewPoolInfo() {
	let client;

	try {
		// Parse command line arguments
		const args = process.argv.slice(2);
		let poolId = null;

		for (let i = 0; i < args.length; i++) {
			if (args[i] === '--pool' && args[i + 1]) {
				poolId = parseInt(args[i + 1]);
				i++;
			}
		}

		if (!poolId && poolId !== 0) {
			const input = await prompt('Enter pool ID: ');
			poolId = parseInt(input);
		}

		if (isNaN(poolId) || poolId < 0) {
			console.error('❌ Invalid pool ID');
			process.exit(1);
		}

		// Initialize client
		client = createClient(env, operatorId, operatorKey);

		console.log('\n╔════════════════════════════════════════════════════════════╗');
		console.log('║         LazyLotto Pool Info (Extended)                    ║');
		console.log('╚════════════════════════════════════════════════════════════╝\n');
		console.log(`📍 Environment: ${env.toUpperCase()}`);
		console.log(`🎰 Pool: #${poolId}\n`);

		// Load contract ABIs
		const poolManagerIface = loadInterface('LazyLottoPoolManager');

		console.log('🔍 Fetching pool ownership...\n');

		// Get pool owner
		const ownerResult = await queryContract(env, poolManagerId, poolManagerIface, 'getPoolOwner', [poolId], operatorId);
		const ownerAddress = ownerResult[0];

		const poolOwner = await convertToHederaId(ownerAddress);
		const isGlobalPool = ownerAddress === '0x0000000000000000000000000000000000000000';

		console.log('═══════════════════════════════════════════════════════════');
		console.log('  OWNERSHIP');
		console.log('═══════════════════════════════════════════════════════════');
		console.log(`  Type:             ${isGlobalPool ? 'Global (Admin-owned)' : 'Community (User-owned)'}`);
		console.log(`  Owner:            ${isGlobalPool ? 'N/A (Global pool)' : poolOwner}`);
		console.log('═══════════════════════════════════════════════════════════\n');

		// Get proceeds for HBAR
		console.log('🔍 Fetching HBAR proceeds...\n');
		const [hbarTotal, hbarWithdrawn] = await queryContract(env, poolManagerId, poolManagerIface, 'getPoolProceeds', [
			poolId,
			'0x0000000000000000000000000000000000000000',
		], operatorId);
		const hbarAvailable = BigInt(hbarTotal) - BigInt(hbarWithdrawn);

		console.log('═══════════════════════════════════════════════════════════');
		console.log('  HBAR PROCEEDS');
		console.log('═══════════════════════════════════════════════════════════');
		console.log(`  Total Collected:  ${new Hbar(Number(hbarTotal), HbarUnit.Tinybar).toString()}`);
		console.log(`  Withdrawn:        ${new Hbar(Number(hbarWithdrawn), HbarUnit.Tinybar).toString()}`);
		console.log(`  Available:        ${new Hbar(Number(hbarAvailable), HbarUnit.Tinybar).toString()}`);
		console.log('═══════════════════════════════════════════════════════════\n');

		// Get proceeds for LAZY (if applicable)
		if (lazyTokenId) {
			console.log('🔍 Fetching LAZY proceeds...\n');

			// Convert Hedera token ID to solidity address
			const lazyTokenSolidity = '0x' + TokenId.fromString(lazyTokenId).toSolidityAddress();

			const [lazyTotal, lazyWithdrawn] = await queryContract(env, poolManagerId, poolManagerIface, 'getPoolProceeds', [poolId, lazyTokenSolidity], operatorId);
			const lazyAvailable = BigInt(lazyTotal) - BigInt(lazyWithdrawn);

			console.log('═══════════════════════════════════════════════════════════');
			console.log('  LAZY PROCEEDS');
			console.log('═══════════════════════════════════════════════════════════');
			console.log(`  Total Collected:  ${lazyTotal} LAZY`);
			console.log(`  Withdrawn:        ${lazyWithdrawn} LAZY`);
			console.log(`  Available:        ${lazyAvailable} LAZY`);
			console.log('═══════════════════════════════════════════════════════════\n');
		}

		console.log('💡 For detailed pool configuration (win rate, prizes, etc.), use:');
		console.log(`   node scripts/interactions/LazyLotto/queries/poolInfo.js ${poolId}\n`);

	}
	catch (error) {
		console.error('\n❌ Error fetching pool info:', error.message);
		if (error.status) {
			console.error('Status:', error.status.toString());
		}
		process.exit(1);
	}
	finally {
		if (client) {
			client.close();
		}
	}
}

// Run the script
viewPoolInfo();
