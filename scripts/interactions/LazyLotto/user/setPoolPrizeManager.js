/**
 * Set Pool Prize Manager
 *
 * Allows pool owner to set the prize manager for their owned pool.
 * The prize manager has the authority to draw prizes for the pool.
 *
 * Usage: node scripts/interactions/LazyLotto/user/setPoolPrizeManager.js [poolId] [prizeManagerAccountId]
 *        If parameters not provided, will prompt for input
 */

require('dotenv').config();
const {
	AccountId,
	ContractExecuteTransaction,
} = require('@hashgraph/sdk');
const { createClient, getEnvConfig, getContractId } = require('../../../../utils/clientFactory');
const { loadInterface } = require('../../../../utils/abiLoader');
const { prompt } = require('../../../../utils/promptHelpers');
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

async function setPoolPrizeManager(poolId, prizeManagerAccountId) {
	let client;

	try {
		// Initialize client
		client = createClient(env, operatorId, operatorKey);

		console.log('\n╔════════════════════════════════════════════════════════════╗');
		console.log('║              Set Pool Prize Manager                       ║');
		console.log('╚════════════════════════════════════════════════════════════╝\n');
		console.log(`📍 Environment: ${env.toUpperCase()}`);
		console.log(`📄 Pool Manager: ${poolManagerId.toString()}`);
		console.log(`👤 Pool Owner: ${operatorId.toString()}\n`);

		// Load interfaces
		const poolManagerIface = loadInterface('LazyLottoPoolManager');
		const lazyLottoIface = loadInterface('LazyLotto');

		// Get pool info
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
		console.log(`🎱 Pool #${poolId} Information`);
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

		// Get pool name
		const poolInfo = await queryContract(env, lazyLottoId, lazyLottoIface, 'getPoolBasicInfo', [poolId], operatorId);
		const poolWinCID = poolInfo[1];

		console.log(`   Pool #${poolId} (Win CID: "${poolWinCID.substring(0, 20)}...")`);

		// Verify ownership
		const owner = await queryContract(env, poolManagerId, poolManagerIface, 'getPoolOwner', [poolId], operatorId);
		const ownerHederaId = await convertToHederaId(owner[0]);

		console.log(`   Owner: ${ownerHederaId}`);

		if (ownerHederaId !== operatorId.toString()) {
			console.log('\n❌ Error: You do not own this pool. Only the pool owner can set the prize manager.\n');
			return;
		}

		// Get current prize manager
		const currentPrizeManager = await queryContract(env, poolManagerId, poolManagerIface, 'getPoolPrizeManager', [poolId], operatorId);
		const currentPrizeManagerHederaId = currentPrizeManager[0] && currentPrizeManager[0] !== '0x0000000000000000000000000000000000000000'
			? await convertToHederaId(currentPrizeManager[0])
			: 'Not Set';

		console.log(`   Current Prize Manager: ${currentPrizeManagerHederaId}\n`);

		// Convert new prize manager to EVM address
		const prizeManagerEvmAddress = await convertToEvmAddress(prizeManagerAccountId);

		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
		console.log('🆕 New Prize Manager');
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

		console.log(`   Account: ${prizeManagerAccountId}\n`);

		// Confirm
		const confirmAnswer = await prompt('❓ Confirm setting new prize manager? (yes/no): ');
		if (confirmAnswer.toLowerCase() !== 'yes' && confirmAnswer.toLowerCase() !== 'y') {
			console.log('\n❌ Operation cancelled.\n');
			return;
		}

		console.log('\n⏳ Setting prize manager...\n');

		// Execute transaction
		const encodedFunction = poolManagerIface.encodeFunctionData('setPoolPrizeManager', [poolId, prizeManagerEvmAddress]);

		const tx = await new ContractExecuteTransaction()
			.setContractId(poolManagerId)
			.setGas(300000)
			.setFunctionParameters(Buffer.from(encodedFunction.slice(2), 'hex'))
			.execute(client);

		const receipt = await tx.getReceipt(client);

		if (receipt.status.toString() !== 'SUCCESS') {
			throw new Error(`Transaction failed with status: ${receipt.status.toString()}`);
		}

		console.log('✅ Prize manager updated successfully!\n');
		console.log(`   Transaction: ${tx.transactionId.toString()}`);
		console.log(`   Status: ${receipt.status.toString()}\n`);

		// Verify new prize manager
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
		console.log('✓ Verified New Prize Manager');
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

		const newPrizeManager = await queryContract(env, poolManagerId, poolManagerIface, 'getPoolPrizeManager', [poolId], operatorId);
		const newPrizeManagerHederaId = await convertToHederaId(newPrizeManager[0]);

		console.log(`   Pool #${poolId}`);
		console.log(`   Prize Manager: ${newPrizeManagerHederaId}\n`);

		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

	}
	catch (error) {
		console.error('\n❌ Error setting pool prize manager:');
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
	// Check for command line arguments
	let poolId = process.argv[2];
	let prizeManagerAccountId = process.argv[3];

	// If not provided, prompt
	if (!poolId) {
		poolId = await prompt('Enter Pool ID: ');
	}

	if (!prizeManagerAccountId) {
		prizeManagerAccountId = await prompt('Enter Prize Manager Account ID (e.g., 0.0.12345): ');
	}

	poolId = parseInt(poolId);

	if (isNaN(poolId) || poolId < 0) {
		console.error('❌ Invalid pool ID. Must be a non-negative integer.');
		process.exit(1);
	}

	try {
		AccountId.fromString(prizeManagerAccountId);
	}
	catch (error) {
		console.error('❌ Invalid account ID format.', error.message);
		process.exit(1);
	}

	await setPoolPrizeManager(poolId, prizeManagerAccountId);
}

// Run the script
main();
