/**
 * LazyLotto Withdraw Pool Proceeds Script
 *
 * Withdraws accumulated proceeds from a community pool (95% to owner, 5% to platform).
 * Must be the pool owner or an admin.
 *
 * Usage: node scripts/interactions/LazyLotto/user/withdraw-pool-proceeds.js --pool <poolId> [--token <tokenId>]
 */

require('dotenv').config();
const {
	Hbar,
	HbarUnit,
} = require('@hashgraph/sdk');
const { createClient, getEnvConfig, getContractId } = require('../../../../utils/clientFactory');
const { loadInterface } = require('../../../../utils/abiLoader');
const { prompt } = require('../../../../utils/promptHelpers');
const { queryContract } = require('../../../../utils/queryHelpers');

const { homebrewPopulateAccountNum, EntityType, getTokenDetails } = require('../../../../utils/hederaMirrorHelpers');
const { sleep } = require('../../../../utils/nodeHelpers');

// Environment setup
const { operatorId, operatorKey, env } = getEnvConfig();
const contractId = getContractId('LAZY_LOTTO_CONTRACT_ID');
const poolManagerId = getContractId('LAZY_LOTTO_POOL_MANAGER_ID');

// Helper: Convert Hedera ID to EVM address
async function convertToHederaId(evmAddress, entityType = null) {
	if (!evmAddress.startsWith('0x')) return evmAddress;
	if (evmAddress === '0x0000000000000000000000000000000000000000') return 'HBAR';
	return await homebrewPopulateAccountNum(env, evmAddress, entityType);
}

async function withdrawPoolProceeds() {
	let client;

	try {
		// Parse command line arguments
		const args = process.argv.slice(2);
		let poolId = null;
		let tokenId = null;

		for (let i = 0; i < args.length; i++) {
			if (args[i] === '--pool' && args[i + 1]) {
				poolId = parseInt(args[i + 1]);
				i++;
			}
			else if (args[i] === '--token' && args[i + 1]) {
				tokenId = args[i + 1];
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

		// Default to HBAR if no token specified
		if (!tokenId) {
			tokenId = '0x0000000000000000000000000000000000000000';
		}

		// Initialize client
		client = createClient(env, operatorId, operatorKey);

		console.log('\n╔════════════════════════════════════════════════════════════╗');
		console.log('║         LazyLotto Withdraw Pool Proceeds                  ║');
		console.log('╚════════════════════════════════════════════════════════════╝\n');
		console.log(`📍 Environment: ${env.toUpperCase()}`);
		console.log(`📄 LazyLotto Contract: ${contractId.toString()}`);
		console.log(`📄 PoolManager Contract: ${poolManagerId.toString()}`);
		console.log(`🎰 Pool: #${poolId}\n`);

		// Load contract ABIs
		const lazyLottoIface = loadInterface('LazyLotto');
		const poolManagerIface = loadInterface('LazyLottoPoolManager');

		const { contractExecuteFunction } = require('../../../../utils/solidityHelpers');
		const { estimateGas } = require('../../../../utils/gasHelpers');

		// Get pool owner
		console.log('🔍 Checking pool ownership...\n');
		const ownerResult = await queryContract(env, poolManagerId, poolManagerIface, 'getPoolOwner', [poolId], operatorId);
		const ownerAddress = ownerResult[0];

		const poolOwner = await convertToHederaId(ownerAddress);
		const yourAddress = operatorId.toString();

		console.log('═══════════════════════════════════════════════════════════');
		console.log('  OWNERSHIP');
		console.log('═══════════════════════════════════════════════════════════');
		console.log(`  Pool Owner:       ${poolOwner}`);
		console.log(`  Your Address:     ${yourAddress}`);
		console.log('═══════════════════════════════════════════════════════════\n');

		if (poolOwner !== yourAddress) {
			console.log('⚠️  You are not the pool owner');

			// Check if user is admin
			const isAdminResult = await queryContract(env, contractId, lazyLottoIface, 'isAdmin', [operatorId.toSolidityAddress()], operatorId);
			const isAdmin = isAdminResult[0];

			if (!isAdmin) {
				console.error('❌ Only pool owner or admin can withdraw proceeds');
				process.exit(1);
			}
			console.log('ℹ️  Proceeding as admin\n');
		}

		// Get proceeds info
		console.log('🔍 Fetching proceeds information...\n');
		const [total, withdrawn] = await queryContract(env, poolManagerId, poolManagerIface, 'getPoolProceeds', [poolId, tokenId], operatorId);

		const available = BigInt(total) - BigInt(withdrawn);

		const tokenHederaId = await convertToHederaId(tokenId, EntityType.TOKEN);
		let tokenDets = null;
		if (tokenHederaId !== 'HBAR') {
			tokenDets = await getTokenDetails(env, tokenHederaId);
		}

		console.log('═══════════════════════════════════════════════════════════');
		console.log('  PROCEEDS STATUS');
		console.log('═══════════════════════════════════════════════════════════');
		console.log(`  Token:            ${tokenHederaId === 'HBAR' ? 'HBAR' : `${tokenDets.symbol} (${tokenHederaId})`}`);
		console.log(`  Total Collected:  ${tokenHederaId === 'HBAR' ? new Hbar(Number(total), HbarUnit.Tinybar).toString() : `${Number(total) / (10 ** tokenDets.decimals)} ${tokenDets.symbol}`}`);
		console.log(`  Already Withdrawn: ${tokenHederaId === 'HBAR' ? new Hbar(Number(withdrawn), HbarUnit.Tinybar).toString() : `${Number(withdrawn) / (10 ** tokenDets.decimals)} ${tokenDets.symbol}`}`);
		console.log(`  Available:        ${tokenHederaId === 'HBAR' ? new Hbar(Number(available), HbarUnit.Tinybar).toString() : `${Number(available) / (10 ** tokenDets.decimals)} ${tokenDets.symbol}`}`);
		console.log('═══════════════════════════════════════════════════════════\n');

		if (available === 0n) {
			console.log('⚠️  No proceeds available to withdraw');
			process.exit(0);
		}

		// Get platform percentage
		const platformPercentageResult = await queryContract(env, poolManagerId, poolManagerIface, 'platformProceedsPercentage', [], operatorId);
		const platformPercentage = platformPercentageResult[0];

		// Calculate expected split
		const ownerShare = (available * (100n - BigInt(platformPercentage))) / 100n;
		const platformCut = available - ownerShare;

		console.log('═══════════════════════════════════════════════════════════');
		console.log('  WITHDRAWAL SPLIT');
		console.log('═══════════════════════════════════════════════════════════');
		console.log(`  Your Share (${100 - Number(platformPercentage)}%):  ${tokenHederaId === 'HBAR' ? new Hbar(Number(ownerShare), HbarUnit.Tinybar).toString() : `${Number(ownerShare) / (10 ** tokenDets.decimals)} ${tokenDets.symbol}`}`);
		console.log(`  Platform Cut (${Number(platformPercentage)}%):   ${tokenHederaId === 'HBAR' ? new Hbar(Number(platformCut), HbarUnit.Tinybar).toString() : `${Number(platformCut) / (10 ** tokenDets.decimals)} ${tokenDets.symbol}`}`);
		console.log('═══════════════════════════════════════════════════════════\n');

		// Estimate gas
		const gasInfo = await estimateGas(
			env,
			contractId,
			lazyLottoIface,
			operatorId,
			'withdrawPoolProceeds',
			[poolId, tokenId],
			500_000,
		);
		const gasEstimate = gasInfo.gasLimit;

		// Confirm withdrawal
		const confirmAnswer = await prompt('Proceed with withdrawal? (yes/no): ');
		if (confirmAnswer.toLowerCase() !== 'yes' && confirmAnswer.toLowerCase() !== 'y') {
			console.log('\n❌ Withdrawal cancelled');
			process.exit(0);
		}

		// Execute withdrawal
		console.log('\n🔄 Withdrawing proceeds...');

		const gasLimit = Math.floor(gasEstimate * 1.2);

		const [receipt, , record] = await contractExecuteFunction(
			contractId,
			lazyLottoIface,
			client,
			gasLimit,
			'withdrawPoolProceeds',
			[poolId, tokenId],
		);

		if (receipt.status.toString() !== 'SUCCESS') {
			console.error('\n❌ Transaction failed');
			console.error('Status:', receipt.status.toString());
			process.exit(1);
		}

		console.log('\n✅ Withdrawal successful!');
		console.log(`📋 Transaction: ${record.transactionId.toString()}`);
		console.log('⏳ Waiting 5 seconds for mirror node to sync...\n');
		await sleep(5000);

		// Verify updated proceeds
		console.log('🔍 Fetching updated proceeds...\n');
		const [newTotal, newWithdrawn] = await queryContract(env, poolManagerId, poolManagerIface, 'getPoolProceeds', [poolId, tokenId], operatorId);

		const newAvailable = BigInt(newTotal) - BigInt(newWithdrawn);

		console.log('═══════════════════════════════════════════════════════════');
		console.log('  UPDATED PROCEEDS');
		console.log('═══════════════════════════════════════════════════════════');
		console.log(`  Total Collected:  ${tokenHederaId === 'HBAR' ? new Hbar(Number(newTotal), HbarUnit.Tinybar).toString() : `${Number(newTotal) / (10 ** tokenDets.decimals)} ${tokenDets.symbol}`}`);
		console.log(`  Withdrawn:        ${tokenHederaId === 'HBAR' ? new Hbar(Number(newWithdrawn), HbarUnit.Tinybar).toString() : `${Number(newWithdrawn) / (10 ** tokenDets.decimals)} ${tokenDets.symbol}`}`);
		console.log(`  Available:        ${tokenHederaId === 'HBAR' ? new Hbar(Number(newAvailable), HbarUnit.Tinybar).toString() : `${Number(newAvailable) / (10 ** tokenDets.decimals)} ${tokenDets.symbol}`}`);
		console.log('═══════════════════════════════════════════════════════════\n');

	}
	catch (error) {
		console.error('\n❌ Error withdrawing proceeds:', error.message);
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
withdrawPoolProceeds();
