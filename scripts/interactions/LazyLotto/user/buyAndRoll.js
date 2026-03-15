/**
 * LazyLotto Buy and Roll Entry Script
 *
 * Combined operation: Buy entry tickets and immediately roll them.
 * More efficient than separate buy + roll transactions.
 * Handles HBAR and token payments with proper allowance management.
 *
 * Usage: node scripts/interactions/LazyLotto/user/buyAndRoll.js [poolId] [ticketCount]
 */

require('dotenv').config();
const {
	ContractId,
	TokenId,
	Hbar,
	HbarUnit,
} = require('@hashgraph/sdk');
const { createClient, getEnvConfig, getContractId } = require('../../../../utils/clientFactory');
const { loadInterface } = require('../../../../utils/abiLoader');
const { prompt } = require('../../../../utils/promptHelpers');
const { queryContract } = require('../../../../utils/queryHelpers');
const { associateTokensToAccount, setFTAllowance } = require('../../../../utils/hederaHelpers');
const { getTokenDetails } = require('../../../../utils/hederaMirrorHelpers');

// Environment setup
const { operatorId, operatorKey, env } = getEnvConfig();
const contractId = getContractId('LAZY_LOTTO_CONTRACT_ID');
const lazyTokenId = process.env.LAZY_TOKEN_ID ? TokenId.fromString(process.env.LAZY_TOKEN_ID) : null;
const lazyGasStationId = process.env.LAZY_GAS_STATION ? ContractId.fromString(process.env.LAZY_GAS_STATION) : null;

// Helper: Convert EVM address to Hedera ID
async function convertToHederaId(evmAddress) {
	if (evmAddress === '0x0000000000000000000000000000000000000000') {
		return 'HBAR';
	}
	const { homebrewPopulateAccountNum } = require('../../../../utils/hederaMirrorHelpers');
	const hederaId = await homebrewPopulateAccountNum(env, evmAddress);
	return hederaId ? hederaId.toString() : evmAddress;
}

// Helper: Format win rate
function formatWinRate(thousandthsOfBps) {
	return (thousandthsOfBps / 1_000_000).toFixed(4) + '%';
}

async function buyAndRoll() {
	let client;

	try {
		// Get parameters
		let poolIdStr = process.argv[2];
		let ticketCountStr = process.argv[3];

		if (!poolIdStr) {
			poolIdStr = await prompt('Enter pool ID: ');
		}

		const poolId = parseInt(poolIdStr);
		if (isNaN(poolId) || poolId < 0) {
			console.error('❌ Invalid pool ID');
			process.exit(1);
		}

		if (!ticketCountStr) {
			ticketCountStr = await prompt('Enter number of tickets to buy and roll: ');
		}

		const ticketCount = parseInt(ticketCountStr);
		if (isNaN(ticketCount) || ticketCount <= 0) {
			console.error('❌ Invalid ticket count');
			process.exit(1);
		}

		// Initialize client
		client = createClient(env, operatorId, operatorKey);

		console.log('\n╔════════════════════════════════════════════════════════════╗');
		console.log('║          LazyLotto Buy & Roll Entries (Combined)          ║');
		console.log('╚════════════════════════════════════════════════════════════╝\n');
		console.log(`📍 Environment: ${env.toUpperCase()}`);
		console.log(`📄 Contract: ${contractId.toString()}`);
		console.log(`🎰 Pool: #${poolId}`);
		console.log(`🎫 Tickets: ${ticketCount}\n`);

		// Load contract ABI
		const lazyLottoIface = loadInterface('LazyLotto');

		// Import helpers
		const { contractExecuteFunction } = require('../../../../utils/solidityHelpers');
		const { estimateGas } = require('../../../../utils/gasHelpers');
		const { checkMirrorBalance, checkMirrorHbarBalance } = require('../../../../utils/hederaMirrorHelpers');

		// Get pool details
		console.log('🔍 Fetching pool details...\n');

		// eslint-disable-next-line no-unused-vars
		const [ticketCID, winCID, winRate, entryFee, prizeCount, outstanding, poolTokenId, paused, closed, feeToken] =
			await queryContract(env, contractId, lazyLottoIface, 'getPoolBasicInfo', [poolId], operatorId);

		if (closed) {
			console.error('❌ Pool is closed');
			process.exit(1);
		}

		if (paused) {
			console.error('❌ Pool is paused');
			process.exit(1);
		}

		// Get storage contract address
		const storageResult = await queryContract(env, contractId, lazyLottoIface, 'storageContract', [], operatorId);
		const storageAddress = storageResult[0];
		const storageContractId = ContractId.fromSolidityAddress(storageAddress);

		// Get fee token details
		const feeTokenHederaId = await convertToHederaId(feeToken);
		let tokenDetails = null;
		if (feeTokenHederaId !== 'HBAR') {
			tokenDetails = await getTokenDetails(env, feeTokenHederaId);
		}

		// Calculate total cost
		const totalCost = BigInt(entryFee) * BigInt(ticketCount);

		// Get bonus calculation
		const boostResult = await queryContract(env, contractId, lazyLottoIface, 'calculateBoost', [operatorId.toSolidityAddress()], operatorId);
		const boost = boostResult[0];

		const baseWinRate = Number(winRate);
		const effectiveWinRate = Math.min(baseWinRate + Number(boost), 100_000_000);

		// Display pool info
		console.log('═══════════════════════════════════════════════════════════');
		console.log('  POOL INFORMATION');
		console.log('═══════════════════════════════════════════════════════════');
		console.log(`  Base Win Rate:        ${formatWinRate(baseWinRate)}`);
		if (Number(boost) > 0) {
			console.log(`  Your Bonus:           +${formatWinRate(Number(boost))}`);
			console.log(`  Effective Win Rate:   ${formatWinRate(effectiveWinRate)}`);
		}
		console.log(`  Entry Fee:            ${feeTokenHederaId === 'HBAR' ? new Hbar(Number(entryFee), HbarUnit.Tinybar).toString() : `${Number(entryFee) / (10 ** tokenDetails.decimals)} ${tokenDetails.symbol}`}`);
		console.log(`  Prize Packages:       ${prizeCount}`);
		console.log(`  Outstanding Entries:  ${outstanding}`);
		console.log('═══════════════════════════════════════════════════════════\n');

		console.log('═══════════════════════════════════════════════════════════');
		console.log('  PURCHASE SUMMARY');
		console.log('═══════════════════════════════════════════════════════════');
		console.log(`  Tickets:              ${ticketCount}`);
		console.log(`  Total Cost:           ${feeTokenHederaId === 'HBAR' ? new Hbar(Number(totalCost), HbarUnit.Tinybar).toString() : `${Number(totalCost) / (10 ** tokenDetails.decimals)} ${tokenDetails.symbol}`}`);
		console.log(`  Payment Token:        ${feeTokenHederaId}`);
		console.log('═══════════════════════════════════════════════════════════\n');

		// Check balance and set allowances for fungible tokens
		if (feeTokenHederaId !== 'HBAR') {
			const feeTokenId = TokenId.fromString(feeTokenHederaId);

			// Check balance
			console.log('🔍 Checking token balance...');
			const balance = await checkMirrorBalance(env, operatorId, feeTokenHederaId);

			if (balance === null) {
				console.log('🔗 Token not associated. Associating...');
				const result = await associateTokensToAccount(client, operatorId, operatorKey, [feeTokenId]);
				if (result !== 'SUCCESS') {
					console.error('❌ Failed to associate token');
					process.exit(1);
				}
				console.log('✅ Token associated');
				console.log('⏳ Waiting 5 seconds for mirror node to sync...');
				await new Promise(resolve => setTimeout(resolve, 5000));
			}

			const currentBalance = await checkMirrorBalance(env, operatorId, feeTokenHederaId);
			console.log(`💰 Your balance: ${Number(currentBalance) / (10 ** tokenDetails.decimals)} ${tokenDetails.symbol}`);

			if (BigInt(currentBalance) < totalCost) {
				console.error('\n❌ Insufficient token balance');
				console.error(`   Required: ${Number(totalCost) / (10 ** tokenDetails.decimals)} ${tokenDetails.symbol}`);
				console.error(`   Available: ${Number(currentBalance) / (10 ** tokenDetails.decimals)} ${tokenDetails.symbol}`);
				process.exit(1);
			}
			console.log('✅ Balance sufficient\n');

			// Set allowance based on token type
			const isLazy = lazyTokenId && feeTokenHederaId === lazyTokenId.toString();
			const spenderContract = isLazy ? lazyGasStationId : storageContractId;
			const spenderName = isLazy ? 'LazyGasStation' : 'Storage';

			console.log(`🔗 Setting token allowance to ${spenderName} contract...`);
			console.log(`   Spender: ${spenderContract.toString()}`);
			console.log(`   Amount: ${Number(totalCost) / (10 ** tokenDetails.decimals)} ${tokenDetails.symbol}`);

			const allowanceResult = await setFTAllowance(
				client,
				feeTokenId,
				operatorId,
				spenderContract,
				totalCost,
			);

			if (allowanceResult !== 'SUCCESS') {
				console.error('❌ Failed to set token allowance');
				process.exit(1);
			}
			console.log('✅ Allowance set successfully\n');
		}
		else {
			// HBAR payment - check balance
			console.log('🔍 Checking HBAR balance...');
			const hbarBalance = await checkMirrorHbarBalance(env, operatorId);

			const hbarBalanceHbar = new Hbar(Number(hbarBalance), HbarUnit.Tinybar);
			const totalCostHbar = new Hbar(Number(totalCost), HbarUnit.Tinybar);

			console.log(`💰 Your balance: ${hbarBalanceHbar.toString()}`);

			if (BigInt(hbarBalance) < totalCost) {
				console.error('\n❌ Insufficient HBAR balance');
				console.error(`   Required: ${totalCostHbar.toString()}`);
				console.error(`   Available: ${hbarBalanceHbar.toString()}`);
				process.exit(1);
			}
			console.log('✅ Balance sufficient\n');
		}

		// Estimate gas with 2x multiplier for roll operations
		console.log('⛽ Estimating gas (2x multiplier for rolls)...');

		const gasInfo = await estimateGas(
			env,
			contractId,
			lazyLottoIface,
			operatorId,
			'buyAndRollEntry',
			[poolId, ticketCount],
			400_000 + 75_000 * ticketCount,
			feeTokenHederaId === 'HBAR' ? Number(totalCost) : 0,
		);
		const baseGas = gasInfo.gasLimit;
		const gasWithMultiplier = Math.floor(baseGas * 2);
		const gasLimit = Math.floor(gasWithMultiplier * 1.2);

		console.log(`   Base estimate: ${baseGas} gas`);
		console.log(`   With 2x multiplier: ${gasWithMultiplier} gas`);
		console.log(`   With 20% buffer: ${gasLimit} gas\n`);

		// Confirm
		const confirmAnswer = await prompt(`Buy ${ticketCount} tickets and roll immediately? (yes/no): `);
		if (confirmAnswer.toLowerCase() !== 'yes' && confirmAnswer.toLowerCase() !== 'y') {
			console.log('\n❌ Operation cancelled');
			process.exit(0);
		}

		// Execute
		console.log('\n🔄 Buying and rolling tickets...');

		const payableAmount = feeTokenHederaId === 'HBAR' ? totalCost : 0;

		const [receipt, results, record] = await contractExecuteFunction(
			contractId,
			lazyLottoIface,
			client,
			gasLimit,
			'buyAndRollEntry',
			[poolId, ticketCount],
			new Hbar(payableAmount, HbarUnit.Tinybar),
		); if (receipt.status.toString() !== 'SUCCESS') {
			console.error('\n❌ Transaction failed');
			process.exit(1);
		}

		console.log('\n✅ Buy and roll completed!');
		console.log(`📋 Transaction: ${record.transactionId.toString()}\n`);

		// Decode results - results is already decoded by contractExecuteFunction
		let wins = 0;
		let offset = 0; if (results && results.length >= 2) {
			wins = Number(results[0]);
			offset = Number(results[1]);
			// Calculate actual win rate
			const actualWinRate = ticketCount > 0 ? ((wins / ticketCount) * 100).toFixed(2) : '0.00';

			console.log('═══════════════════════════════════════════════════════════');
			console.log('  ROLL RESULTS');
			console.log('═══════════════════════════════════════════════════════════');
			console.log(`  Tickets Rolled:       ${ticketCount}`);
			console.log(`  Wins:                 ${wins}`);
			console.log(`  Actual Win Rate:      ${actualWinRate}%`);
			console.log(`  Expected Win Rate:    ${formatWinRate(effectiveWinRate)}`);
			if (wins > 0) {
				console.log(`  Pending Prize Index:  Starting at ${offset}`);
			}
			console.log('═══════════════════════════════════════════════════════════\n');

			if (wins > 0) {
				console.log('🎉 Congratulations! You won prizes!');
				console.log('   Use userState.js to view your pending prizes');
				console.log('   Use claimPrize.js or claimAllPrizes.js to claim them\n');
			}
			else {
				console.log('😔 No wins this time. Better luck next time!\n');
			}
		}
	}
	catch (error) {
		console.error('\n❌ Error buying and rolling:', error.message);
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
buyAndRoll();
