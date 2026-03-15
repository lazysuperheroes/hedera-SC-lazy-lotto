/**
 * LazyLotto Roll Tickets Script
 *
 * Roll (play) your memory entries to win prizes.
 * Uses 2x gas multiplier due to PRNG uncertainty.
 *
 * Supports:
 * - Roll all entries at once
 * - Roll specific quantity in batches
 * - Roll with NFT boost (provide NFT serial)
 *
 * Usage: node scripts/interactions/LazyLotto/user/rollTickets.js [poolId] [quantity] [nftSerial]
 */

require('dotenv').config();
const { createClient, getEnvConfig, getContractId } = require('../../../../utils/clientFactory');
const { loadInterface } = require('../../../../utils/abiLoader');
const { prompt } = require('../../../../utils/promptHelpers');
const { queryContract } = require('../../../../utils/queryHelpers');

// Environment setup
const { operatorId, operatorKey, env } = getEnvConfig();
const contractId = getContractId('LAZY_LOTTO_CONTRACT_ID');

// Helper: Convert Hedera ID to EVM address
async function convertToHederaId(evmAddress) {
	if (!evmAddress.startsWith('0x')) return evmAddress;
	if (evmAddress === '0x0000000000000000000000000000000000000000') return 'HBAR';
	const { homebrewPopulateAccountNum } = require('../../../../utils/hederaMirrorHelpers');
	return await homebrewPopulateAccountNum(env, evmAddress);
}

// Helper: Format win rate
function formatWinRate(thousandthsOfBps) {
	return (thousandthsOfBps / 1_000_000).toFixed(4) + '%';
}

async function rollTickets() {
	let client;

	try {
		// Get parameters
		let poolIdStr = process.argv[2];
		let quantityStr = process.argv[3];
		const nftSerialStr = process.argv[4];

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
		console.log('║              LazyLotto Roll Tickets                       ║');
		console.log('╚════════════════════════════════════════════════════════════╝\n');
		console.log(`📍 Environment: ${env.toUpperCase()}`);
		console.log(`📄 Contract: ${contractId.toString()}`);
		console.log(`🎰 Pool: #${poolId}\n`);

		// Load contract ABI
		const lazyLottoIface = loadInterface('LazyLotto');

		// Import helpers
		const { contractExecuteFunction } = require('../../../../utils/solidityHelpers');
		const { estimateGas } = require('../../../../utils/gasHelpers');

		console.log('🔍 Checking your entries...\n');

		// Get user's entries
		const userEvmAddress = '0x' + operatorId.toSolidityAddress();
		const entries = await queryContract(env, contractId, lazyLottoIface, 'getUsersEntries', [poolId, userEvmAddress], operatorId);

		const totalEntries = Number(entries[0]);

		if (totalEntries === 0) {
			console.error('❌ You have no entries in this pool');
			process.exit(1);
		}

		console.log(`✅ You have ${totalEntries} entries in pool #${poolId}\n`);

		// Get pool details
		// eslint-disable-next-line no-unused-vars
		const [ticketCID, winCID, winRate, entryFee, newPrizeCount, outstanding, poolTokenAddress, paused, closed, feeToken] =
			await queryContract(env, contractId, lazyLottoIface, 'getPoolBasicInfo', [poolId], operatorId);

		// Get user's boost
		const boostBps = await queryContract(env, contractId, lazyLottoIface, 'calculateBoost', [userEvmAddress], operatorId);

		const baseWinRate = Number(winRate);
		const boostedWinRate = baseWinRate + Number(boostBps[0]);

		console.log('═══════════════════════════════════════════════════════════');
		console.log('  POOL INFORMATION');
		console.log('═══════════════════════════════════════════════════════════');
		console.log(`  Base Win Rate:    ${formatWinRate(baseWinRate)}`);
		console.log(`  Your Boost:       +${formatWinRate(Number(boostBps[0]))}`);
		console.log(`  Boosted Win Rate: ${formatWinRate(boostedWinRate)}`);
		console.log('═══════════════════════════════════════════════════════════\n');

		// Determine quantity to roll
		let quantity;
		let rollAll = false;

		if (!quantityStr) {
			const response = await prompt(`Roll all ${totalEntries} entries? (yes/no): `);
			if (response.toLowerCase() === 'yes' || response.toLowerCase() === 'y') {
				quantity = totalEntries;
				rollAll = true;
			}
			else {
				quantityStr = await prompt(`Enter quantity to roll (1-${totalEntries}): `);
				quantity = parseInt(quantityStr);
			}
		}
		else {
			quantity = parseInt(quantityStr);
		}

		if (isNaN(quantity) || quantity <= 0 || quantity > totalEntries) {
			console.error(`❌ Invalid quantity (must be 1-${totalEntries})`);
			process.exit(1);
		}

		// Check for NFT boost
		let nftSerial = null;
		if (nftSerialStr) {
			nftSerial = parseInt(nftSerialStr);
			if (isNaN(nftSerial)) {
				console.error('❌ Invalid NFT serial');
				process.exit(1);
			}

			// Verify ownership
			const poolTokenHederaId = await convertToHederaId(poolTokenAddress);
			const { getSerialsOwned } = require('../../../../utils/hederaMirrorHelpers');
			const ownedSerials = await getSerialsOwned(env, operatorId.toString(), poolTokenHederaId);

			if (!ownedSerials.includes(nftSerial)) {
				console.error(`❌ You don't own serial #${nftSerial} of ${poolTokenHederaId}`);
				process.exit(1);
			}

			console.log(`🎫 Using NFT boost: ${poolTokenHederaId} serial #${nftSerial}\n`);
		}

		console.log('═══════════════════════════════════════════════════════════');
		console.log('  ROLL SUMMARY');
		console.log('═══════════════════════════════════════════════════════════');
		console.log(`  Quantity:         ${quantity} entries`);
		console.log(`  Win Rate:         ${formatWinRate(boostedWinRate)}`);
		if (nftSerial !== null) {
			console.log(`  NFT Boost:        Serial #${nftSerial}`);
		}
		console.log('═══════════════════════════════════════════════════════════\n');

		// Estimate gas with 2x multiplier for PRNG uncertainty
		console.log('⛽ Estimating gas (2x multiplier for PRNG)...');

		let functionName;
		let functionArgs;

		if (nftSerial !== null) {
			functionName = 'rollWithNFT';
			functionArgs = [poolId, [nftSerial]];
		}
		else if (rollAll) {
			functionName = 'rollAll';
			functionArgs = [poolId];
		}
		else {
			functionName = 'rollBatch';
			functionArgs = [poolId, quantity];
		}

		const gasInfo = await estimateGas(env, contractId, lazyLottoIface, operatorId, functionName, functionArgs, 800000);
		const baseGasEstimate = gasInfo.gasLimit;
		const gasEstimate = Math.floor(baseGasEstimate * 2); console.log(`   Base estimate: ${baseGasEstimate} gas`);
		console.log(`   With 2x multiplier: ${gasEstimate} gas\n`);

		// Confirm roll
		const confirmAnswer = await prompt('Proceed with rolling? (yes/no): ');
		if (confirmAnswer.toLowerCase() !== 'yes' && confirmAnswer.toLowerCase() !== 'y') {
			console.log('\n❌ Roll cancelled');
			process.exit(0);
		}

		// Execute roll
		console.log('\n🎲 Rolling tickets...');

		const [receipt, results, record] = await contractExecuteFunction(
			contractId,
			lazyLottoIface,
			client,
			gasEstimate,
			functionName,
			functionArgs,
		);

		if (receipt.status.toString() !== 'SUCCESS') {
			console.error('\n❌ Transaction failed');
			process.exit(1);
		}

		console.log('\n✅ Tickets rolled successfully!');
		console.log(`📋 Transaction: ${record.transactionId.toString()}\n`);

		// Decode roll results - results is already decoded by contractExecuteFunction
		let wins = 0;
		if (results && results.length >= 1) {
			wins = Number(results[0]);
		}
		else {
			console.log('⚠️  Could not decode roll results');
		}
		// Calculate actual win rate
		const actualWinRate = quantity > 0 ? ((wins / quantity) * 100).toFixed(2) : '0.00';

		console.log('═══════════════════════════════════════════════════════════');
		console.log('  ROLL RESULTS');
		console.log('═══════════════════════════════════════════════════════════');
		console.log(`  Tickets Rolled:       ${quantity}`);
		console.log(`  Wins:                 ${wins}`);
		console.log(`  Actual Win Rate:      ${actualWinRate}%`);
		console.log(`  Expected Win Rate:    ${formatWinRate(boostedWinRate)}`);
		console.log('═══════════════════════════════════════════════════════════\n');

		// Wait for mirror node sync
		console.log('⏳ Waiting 5 seconds for mirror node to sync...\n');
		await new Promise(resolve => setTimeout(resolve, 5000));

		// Get updated state
		const newEntries = await queryContract(env, contractId, lazyLottoIface, 'getUsersEntries', [poolId, userEvmAddress], operatorId);

		// Get updated pending prizes count
		const prizeCountResult = await queryContract(env, contractId, lazyLottoIface, 'getPendingPrizesCount', [userEvmAddress], operatorId);
		const prizeCount = prizeCountResult[0];

		console.log('═══════════════════════════════════════════════════════════');
		console.log('  UPDATED STATE');
		console.log('═══════════════════════════════════════════════════════════');
		console.log(`  Remaining entries: ${newEntries[0]}`);
		console.log(`  Total pending prizes: ${prizeCount}`);
		console.log('═══════════════════════════════════════════════════════════\n');

		if (wins > 0) {
			console.log('🎉 Congratulations! You won prizes!');
			console.log('💡 Use claimPrize.js or claimAllPrizes.js to claim them\n');
		}
		else {
			console.log('😔 No prizes won this round. Better luck next time!\n');
		}

	}
	catch (error) {
		console.error('\n❌ Error rolling tickets:', error.message);
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
rollTickets();
