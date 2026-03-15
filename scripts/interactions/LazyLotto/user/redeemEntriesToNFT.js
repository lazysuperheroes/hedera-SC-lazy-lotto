/**
 * LazyLotto Redeem Entries to NFT Script
 *
 * Converts memory entries (tickets) to NFT format.
 * Separate from buyAndRedeemToNFT - this only converts existing entries.
 *
 * Usage: node scripts/interactions/LazyLotto/user/redeemEntriesToNFT.js [poolId] [quantity]
 */

require('dotenv').config();
const {
	TokenId,
} = require('@hashgraph/sdk');
const { createClient, getEnvConfig, getContractId } = require('../../../../utils/clientFactory');
const { loadInterface } = require('../../../../utils/abiLoader');
const { prompt } = require('../../../../utils/promptHelpers');
const { queryContract } = require('../../../../utils/queryHelpers');
const { associateTokensToAccount } = require('../../../../utils/hederaHelpers');

// Environment setup
const { operatorId, operatorKey, env } = getEnvConfig();
const contractId = getContractId('LAZY_LOTTO_CONTRACT_ID');

// Helper: Convert EVM address to Hedera ID
async function convertToHederaId(evmAddress) {
	if (evmAddress === '0x0000000000000000000000000000000000000000') {
		return 'HBAR';
	}

	const { homebrewPopulateAccountNum } = require('../../../../utils/hederaMirrorHelpers');
	const hederaId = await homebrewPopulateAccountNum(env, evmAddress);
	return hederaId ? hederaId.toString() : evmAddress;
}

async function redeemEntriesToNFT() {
	let client;

	try {
		let poolIdStr = process.argv[2];
		let quantityStr = process.argv[3];

		if (!poolIdStr) {
			poolIdStr = await prompt('Enter pool ID: ');
		}

		const poolId = parseInt(poolIdStr);
		if (isNaN(poolId) || poolId < 0) {
			console.error('❌ Invalid pool ID');
			process.exit(1);
		}

		// Initialize client
		client = createClient(env, operatorId, operatorKey);

		console.log('\n╔════════════════════════════════════════════════════════════╗');
		console.log('║        LazyLotto Redeem Entries to NFT Tickets            ║');
		console.log('╚════════════════════════════════════════════════════════════╝\n');
		console.log(`📍 Environment: ${env.toUpperCase()}`);
		console.log(`📄 Contract: ${contractId.toString()}`);
		console.log(`🎰 Pool: #${poolId}\n`);

		// Load contract ABI
		const lazyLottoIface = loadInterface('LazyLotto');

		// Import helpers
		const { contractExecuteFunction } = require('../../../../utils/solidityHelpers');
		const { estimateGas } = require('../../../../utils/gasHelpers');

		console.log('🔍 Checking your entries...');

		// Get user's entries
		const userEvmAddress = operatorId.toSolidityAddress();
		const entriesResult = await queryContract(env, contractId, lazyLottoIface, 'getUsersEntries', [poolId, userEvmAddress], operatorId);
		const entries = entriesResult[0];

		const totalEntries = Number(entries);

		if (totalEntries === 0) {
			console.error('\n❌ You have no memory entries in this pool');
			process.exit(1);
		}

		console.log(`✅ You have ${totalEntries} memory entries in pool #${poolId}\n`);

		// Get pool details
		const poolInfo = await queryContract(env, contractId, lazyLottoIface, 'getPoolBasicInfo', [poolId], operatorId);
		const poolTokenId = poolInfo[6];

		const poolTokenHederaId = await convertToHederaId(poolTokenId);
		console.log('Pool Token:', poolTokenHederaId);

		// Associate pool token if needed
		const { checkMirrorBalance } = require('../../../../utils/hederaMirrorHelpers');
		const userBalance = await checkMirrorBalance(env, operatorId, poolTokenHederaId);

		if (userBalance === null) {
			console.log('🔗 Associating pool NFT token...');
			const assocResult = await associateTokensToAccount(
				client,
				operatorId,
				operatorKey,
				[TokenId.fromString(poolTokenHederaId)],
			);

			if (assocResult !== 'SUCCESS') {
				console.error('❌ Failed to associate pool token');
				process.exit(1);
			}
			console.log('✅ Pool token associated');
			console.log('⏳ Waiting 5 seconds for mirror node to sync...');
			await new Promise(resolve => setTimeout(resolve, 5000));
		}
		else {
			console.log('✅ Pool token already associated');
		}
		console.log('');

		// Determine quantity to redeem
		let quantity;

		if (!quantityStr) {
			const response = await prompt(`\nRedeem all ${totalEntries} entries? (yes/no): `);
			if (response.toLowerCase() === 'yes' || response.toLowerCase() === 'y') {
				quantity = totalEntries;
			}
			else {
				quantityStr = await prompt(`Enter quantity to redeem (1-${totalEntries}): `);
				quantity = parseInt(quantityStr);
			}
		}
		else {
			quantity = parseInt(quantityStr);
		}

		if (isNaN(quantity) || quantity <= 0 || quantity > totalEntries) {
			console.error(`\n❌ Invalid quantity (must be 1-${totalEntries})`);
			process.exit(1);
		}

		console.log(`\n📦 Converting ${quantity} memory entries to NFT tickets...\n`);

		// Estimate gas
		const gasInfo = await estimateGas(env, contractId, lazyLottoIface, operatorId, 'redeemEntriesToNFT', [poolId, quantity], 500000);
		const gasEstimate = gasInfo.gasLimit;
		const gasLimit = Math.floor(gasEstimate * 1.2);

		console.log(`⛽ Estimated gas: ${gasEstimate} (with 20% buffer: ${gasLimit})\n`);

		// Confirm
		const confirmAnswer = await prompt('Proceed with redemption? (yes/no): ');
		if (confirmAnswer.toLowerCase() !== 'yes' && confirmAnswer.toLowerCase() !== 'y') {
			console.log('\n❌ Redemption cancelled');
			process.exit(0);
		}

		// Execute the redemption
		console.log('\n🔄 Redeeming entries to NFT tickets...');

		const [receipt, , record] = await contractExecuteFunction(
			contractId,
			lazyLottoIface,
			client,
			gasLimit,
			'redeemEntriesToNFT',
			[poolId, quantity],
		);

		if (receipt.status.toString() !== 'SUCCESS') {
			console.error('\n❌ Transaction failed');
			process.exit(1);
		}

		console.log('\n✅ Entries redeemed to NFT tickets successfully!');
		console.log(`📋 Transaction: ${record.transactionId.toString()}\n`);

		console.log('🎨 Your memory entries have been converted to tradeable NFT tickets.');
		console.log('   You can now:');
		console.log('   - Roll them with rollWithNFT.js');
		console.log('   - Trade them on secondary markets');
		console.log('   - Hold them for later use\n');

	}
	catch (error) {
		console.error('\n❌ Error redeeming entries:', error.message);
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
redeemEntriesToNFT();
