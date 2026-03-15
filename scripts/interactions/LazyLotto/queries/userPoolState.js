/**
 * LazyLotto User Pool State
 *
 * Shows all pools owned by the querying user with:
 * - Pool ID and name
 * - Proceeds (total, withdrawn, available)
 * - Platform fee split
 * - Prize manager
 *
 * Usage: node scripts/interactions/LazyLotto/queries/userPoolState.js [accountId]
 *        If accountId not provided, uses operator account from .env
 */

require('dotenv').config();
const {
	AccountId,
	Hbar,
	HbarUnit,
} = require('@hashgraph/sdk');
const { createClient, getEnvConfig, getContractId } = require('../../../../utils/clientFactory');
const { loadInterface } = require('../../../../utils/abiLoader');
const { queryContract } = require('../../../../utils/queryHelpers');

const { homebrewPopulateAccountNum, EntityType } = require('../../../../utils/hederaMirrorHelpers');

// Environment setup
const { operatorId, operatorKey, env } = getEnvConfig();
const poolManagerId = getContractId('LAZY_LOTTO_POOL_MANAGER_ID');
const lazyLottoId = getContractId('LAZY_LOTTO_CONTRACT_ID');

async function convertToHederaId(evmAddress) {
	if (!evmAddress.startsWith('0x')) return evmAddress;
	return await homebrewPopulateAccountNum(env, evmAddress, EntityType.ACCOUNT);
}

async function convertToEvmAddress(accountId) {
	// Convert Hedera account ID to EVM address format
	const account = AccountId.fromString(accountId);
	const accountNum = account.num;
	const evmAddress = '0x' + accountNum.toString(16).padStart(40, '0');
	return evmAddress;
}

async function getUserPoolState(targetAccountId) {
	let client;

	try {
		// Initialize client
		client = createClient(env, operatorId, operatorKey);

		console.log('\n╔════════════════════════════════════════════════════════════╗');
		console.log('║              LazyLotto User Pool State                    ║');
		console.log('╚════════════════════════════════════════════════════════════╝\n');
		console.log(`📍 Environment: ${env.toUpperCase()}`);
		console.log(`📄 Pool Manager: ${poolManagerId.toString()}`);
		console.log(`📄 LazyLotto: ${lazyLottoId.toString()}`);
		console.log(`👤 Querying as: ${operatorId.toString()}`);
		console.log(`🔍 Target Account: ${targetAccountId.toString()}\n`);

		// Load interfaces
		const poolManagerIface = loadInterface('LazyLottoPoolManager');
		const lazyLottoIface = loadInterface('LazyLotto');

		// Convert account ID to EVM address for query
		const userEvmAddress = await convertToEvmAddress(targetAccountId.toString());

		// Get user's pools
		const userPools = await queryContract(env, poolManagerId, poolManagerIface, 'getUserPools', [userEvmAddress], operatorId);

		const poolIds = userPools[0].map(id => Number(id));

		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
		console.log('🎱 Owned Pools');
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

		if (poolIds.length === 0) {
			console.log('   No pools owned by this account.\n');
			console.log('💡 Create a community pool with:');
			console.log('   node scripts/interactions/LazyLotto/user/createCommunityPool.js\n');
			return;
		}

		console.log(`Total Pools Owned: ${poolIds.length}\n`);

		let totalWithdrawable = 0n;
		let totalEarned = 0n;

		for (const poolId of poolIds) {
			// Get pool info
			const poolInfo = await queryContract(env, lazyLottoId, lazyLottoIface, 'getPoolBasicInfo', [poolId], operatorId);
			const poolFeeToken = poolInfo[9];

			// Check if global pool
			const isGlobal = await queryContract(env, poolManagerId, poolManagerIface, 'isGlobalPool', [poolId], operatorId);

			console.log(`   Pool #${poolId}:`);
			console.log(`      Ticket CID: "${poolInfo[0]}"`);
			console.log(`      Type: ${isGlobal[0] ? 'Global' : 'Community'}`);

			// Get platform fee percentage
			const feePercent = await queryContract(env, poolManagerId, poolManagerIface, 'getPoolPlatformFeePercentage', [poolId], operatorId);
			const platformPercent = Number(feePercent[0]);
			const ownerPercent = 100 - platformPercent;

			// Get pool proceeds (pass feeToken from getPoolBasicInfo result index [9])
			const proceeds = await queryContract(env, poolManagerId, poolManagerIface, 'getPoolProceeds', [poolId, poolFeeToken], operatorId);

			const totalProceeds = proceeds[0];
			const withdrawn = proceeds[1];
			const available = totalProceeds - withdrawn;

			// Calculate owner's share
			const ownerShare = (Number(available) * ownerPercent) / 100;

			totalWithdrawable += BigInt(ownerShare);
			totalEarned += totalProceeds;

			console.log(`      Platform Fee: ${platformPercent}% | Your Share: ${ownerPercent}%`);
			console.log(`      Total Earned: ${new Hbar(totalProceeds, HbarUnit.Tinybar).toString()}`);
			console.log(`      Already Withdrawn: ${new Hbar(withdrawn, HbarUnit.Tinybar).toString()}`);
			console.log(`      Available Now: ${new Hbar(available, HbarUnit.Tinybar).toString()}`);
			console.log(`      Your Withdrawable Share: ${new Hbar(ownerShare, HbarUnit.Tinybar).toString()}`);

			// Get prize manager
			const prizeManager = await queryContract(env, poolManagerId, poolManagerIface, 'getPoolPrizeManager', [poolId], operatorId);
			const prizeManagerHederaId = prizeManager[0] && prizeManager[0] !== '0x0000000000000000000000000000000000000000'
				? await convertToHederaId(prizeManager[0])
				: 'Not Set';

			console.log(`      Prize Manager: ${prizeManagerHederaId}`);
			console.log('');
		}

		// Summary
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
		console.log('📊 Summary');
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
		console.log(`   Total Pools: ${poolIds.length}`);
		console.log(`   Total Earned (All Pools): ${new Hbar(totalEarned, HbarUnit.Tinybar).toString()}`);
		console.log(`   Total Withdrawable Now: ${new Hbar(totalWithdrawable, HbarUnit.Tinybar).toString()}\n`);

		if (totalWithdrawable > 0n) {
			console.log('💡 You have withdrawable proceeds!');
			console.log('   Run: node scripts/interactions/LazyLotto/user/withdrawPoolProceeds.js\n');
		}
		else {
			console.log('💡 No withdrawable proceeds yet.');
			console.log('   Proceeds accumulate as users buy entries in your pools.\n');
		}

		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

	}
	catch (error) {
		console.error('\n❌ Error getting user pool state:');
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
	let targetAccount = process.argv[2];

	// If not provided, use operator account
	if (!targetAccount) {
		targetAccount = operatorId.toString();
	}
	else {
		try {
			targetAccount = AccountId.fromString(targetAccount).toString();
		}
		catch (error) {
			console.error('❌ Invalid account ID format. Use format: 0.0.12345', error.message);
			process.exit(1);
		}
	}

	await getUserPoolState(AccountId.fromString(targetAccount));
}

// Run the script
main();
