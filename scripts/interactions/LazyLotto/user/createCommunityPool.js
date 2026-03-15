/**
 * LazyLotto Create Community Pool Script
 *
 * Creates a new community-owned lottery pool with fees paid in HBAR and LAZY.
 * The pool creator will own the pool and can manage it.
 *
 * Usage: node scripts/interactions/LazyLotto/user/create-community-pool.js
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

const { checkMirrorBalance, checkMirrorHbarBalance, checkMirrorAllowance } = require('../../../../utils/hederaMirrorHelpers');
const { setFTAllowance } = require('../../../../utils/hederaHelpers');
const { sleep } = require('../../../../utils/nodeHelpers');

// Environment setup
const { operatorId, operatorKey, env } = getEnvConfig();
const contractId = getContractId('LAZY_LOTTO_CONTRACT_ID');
const poolManagerId = getContractId('LAZY_LOTTO_POOL_MANAGER_ID');
const lazyTokenId = TokenId.fromString(process.env.LAZY_TOKEN_ID);
const lazyGasStationId = getContractId('LAZY_GAS_STATION_CONTRACT_ID');

// Helper: Format win rate
function formatWinRate(thousandthsOfBps) {
	return (thousandthsOfBps / 1_000_000).toFixed(4) + '%';
}

async function createCommunityPool() {
	let client;

	try {
		// Initialize client
		client = createClient(env, operatorId, operatorKey);

		console.log('\n╔════════════════════════════════════════════════════════════╗');
		console.log('║         LazyLotto Create Community Pool                  ║');
		console.log('╚════════════════════════════════════════════════════════════╝\n');
		console.log(`📍 Environment: ${env.toUpperCase()}`);
		console.log(`📄 LazyLotto Contract: ${contractId.toString()}`);
		console.log(`📄 PoolManager Contract: ${poolManagerId.toString()}\n`);

		// Load contract ABIs
		const lazyLottoIface = loadInterface('LazyLotto');
		const poolManagerIface = loadInterface('LazyLottoPoolManager');

		const { contractExecuteFunction } = require('../../../../utils/solidityHelpers');
		const { estimateGas } = require('../../../../utils/gasHelpers');

		// Get creation fees
		console.log('🔍 Fetching creation fees...\n');
		const [hbarFee, lazyFee] = await queryContract(env, poolManagerId, poolManagerIface, 'getCreationFees', [], operatorId);

		console.log('═══════════════════════════════════════════════════════════');
		console.log('  CREATION FEES');
		console.log('═══════════════════════════════════════════════════════════');
		console.log(`  HBAR Fee:         ${new Hbar(Number(hbarFee), HbarUnit.Tinybar).toString()}`);
		console.log(`  LAZY Fee:         ${Number(lazyFee)} LAZY`);
		console.log('═══════════════════════════════════════════════════════════\n');

		// Check user balances
		console.log('💰 Checking your balances...\n');

		const hbarBalance = await checkMirrorHbarBalance(env, operatorId.toString());
		const lazyBalance = await checkMirrorBalance(env, operatorId.toString(), lazyTokenId.toString());

		// Estimate token creation cost (20 HBAR)
		const tokenCreationCost = 20 * 100_000_000;
		const totalHbarNeeded = Number(hbarFee) + tokenCreationCost;

		console.log('═══════════════════════════════════════════════════════════');
		console.log('  YOUR BALANCES');
		console.log('═══════════════════════════════════════════════════════════');
		console.log(`  HBAR:             ${new Hbar(Number(hbarBalance), HbarUnit.Tinybar).toString()}`);
		console.log(`  LAZY:             ${lazyBalance} LAZY`);
		console.log('═══════════════════════════════════════════════════════════\n');

		console.log('═══════════════════════════════════════════════════════════');
		console.log('  TOTAL COST (ESTIMATED)');
		console.log('═══════════════════════════════════════════════════════════');
		console.log(`  HBAR:             ${new Hbar(totalHbarNeeded, HbarUnit.Tinybar).toString()}`);
		console.log(`    - Creation fee: ${new Hbar(Number(hbarFee), HbarUnit.Tinybar).toString()}`);
		console.log(`    - Token cost:   ${new Hbar(tokenCreationCost, HbarUnit.Tinybar).toString()} (estimated)`);
		console.log(`  LAZY:             ${Number(lazyFee)} LAZY`);
		console.log('═══════════════════════════════════════════════════════════\n');

		// Validate balances
		if (BigInt(hbarBalance) < BigInt(totalHbarNeeded)) {
			console.error('❌ Insufficient HBAR balance');
			console.error(`   Required: ${new Hbar(totalHbarNeeded, HbarUnit.Tinybar).toString()}`);
			console.error(`   Available: ${new Hbar(Number(hbarBalance), HbarUnit.Tinybar).toString()}`);
			process.exit(1);
		}

		if (BigInt(lazyBalance) < BigInt(lazyFee)) {
			console.error('❌ Insufficient LAZY balance');
			console.error(`   Required: ${Number(lazyFee)} LAZY`);
			console.error(`   Available: ${lazyBalance} LAZY`);
			process.exit(1);
		}

		// Check LAZY allowance to LazyGasStation
		console.log('🔍 Checking LAZY allowance to LazyGasStation...');
		const currentAllowance = await checkMirrorAllowance(
			env,
			operatorId.toString(),
			lazyTokenId.toString(),
			lazyGasStationId.toString(),
		);

		if (BigInt(currentAllowance) < BigInt(lazyFee)) {
			console.log('\n⚠️  Insufficient LAZY allowance');
			console.log(`   Current: ${currentAllowance} LAZY`);
			console.log(`   Required: ${Number(lazyFee)} LAZY`);
			console.log(`   Spender: ${lazyGasStationId.toString()}\n`);

			const setAllowance = await prompt('Set LAZY allowance? (yes/no): ');
			if (setAllowance.toLowerCase() !== 'yes' && setAllowance.toLowerCase() !== 'y') {
				console.log('\n❌ Pool creation cancelled - insufficient allowance');
				process.exit(0);
			}

			console.log('\n🔗 Setting LAZY allowance to LazyGasStation...');
			const allowanceResult = await setFTAllowance(
				client,
				lazyTokenId,
				operatorId,
				lazyGasStationId,
				// Set 2x for future transactions
				Number(lazyFee) * 2,
			);

			if (allowanceResult !== 'SUCCESS') {
				console.error('❌ Failed to set LAZY allowance');
				process.exit(1);
			}

			console.log('✅ Allowance set successfully');
			console.log('⏳ Waiting 5 seconds for mirror node to sync...');
			await sleep(5000);
		}
		else {
			console.log(`✅ Sufficient allowance: ${currentAllowance} LAZY\n`);
		}

		// Prompt for pool parameters
		console.log('═══════════════════════════════════════════════════════════');
		console.log('  POOL CONFIGURATION');
		console.log('═══════════════════════════════════════════════════════════\n');

		const name = await prompt('Pool name (e.g., "Community Lottery Pool"): ');
		if (!name || name.trim() === '') {
			console.error('❌ Pool name is required');
			process.exit(1);
		}

		const symbol = await prompt('Pool symbol (e.g., "CLP"): ');
		if (!symbol || symbol.trim() === '') {
			console.error('❌ Pool symbol is required');
			process.exit(1);
		}

		const memo = await prompt('Pool memo (optional, press Enter to skip): ');

		const winRateInput = await prompt('Win rate % (e.g., 1 for 1%): ');
		const winRatePercent = parseFloat(winRateInput);
		if (isNaN(winRatePercent) || winRatePercent <= 0 || winRatePercent > 100) {
			console.error('❌ Invalid win rate (must be between 0 and 100)');
			process.exit(1);
		}
		// Convert % to thousandths of bps
		const winRate = Math.floor(winRatePercent * 1_000_000 / 100);

		const entryFeeInput = await prompt('Entry fee in HBAR (e.g., 10): ');
		const entryFeeHbar = parseFloat(entryFeeInput);
		if (isNaN(entryFeeHbar) || entryFeeHbar <= 0) {
			console.error('❌ Invalid entry fee');
			process.exit(1);
		}
		const entryFee = Math.floor(Number(new Hbar(entryFeeHbar, HbarUnit.Hbar).toTinybars()));

		const ticketCID = await prompt('Ticket NFT CID (or press Enter for default): ') ||
			'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi';

		const winCID = await prompt('Winning NFT CID (or press Enter for default): ') ||
			'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi';

		// Display configuration summary
		console.log('\n═══════════════════════════════════════════════════════════');
		console.log('  CONFIGURATION SUMMARY');
		console.log('═══════════════════════════════════════════════════════════');
		console.log(`  Name:             ${name}`);
		console.log(`  Symbol:           ${symbol}`);
		console.log(`  Memo:             ${memo || '(none)'}`);
		console.log(`  Win Rate:         ${formatWinRate(winRate)}`);
		console.log(`  Entry Fee:        ${new Hbar(entryFee, HbarUnit.Tinybar).toString()}`);
		console.log('  Fee Token:        HBAR');
		console.log(`  Ticket CID:       ${ticketCID.substring(0, 20)}...`);
		console.log(`  Win CID:          ${winCID.substring(0, 20)}...`);
		console.log('═══════════════════════════════════════════════════════════\n');

		console.log('═══════════════════════════════════════════════════════════');
		console.log('  FINAL COST');
		console.log('═══════════════════════════════════════════════════════════');
		console.log(`  HBAR:             ${new Hbar(totalHbarNeeded, HbarUnit.Tinybar).toString()}`);
		console.log(`  LAZY:             ${Number(lazyFee)} LAZY`);
		console.log('═══════════════════════════════════════════════════════════\n');

		// Estimate gas
		// HBAR is Zero address
		const feeToken = '0x0000000000000000000000000000000000000000';
		const royalties = [];

		const gasInfo = await estimateGas(
			env,
			contractId,
			lazyLottoIface,
			operatorId,
			'createPool',
			[name, symbol, memo, royalties, ticketCID, winCID, winRate, entryFee, feeToken],
			3_000_000,
			totalHbarNeeded,
		);
		const gasEstimate = gasInfo.gasLimit;

		// Final confirmation
		const confirmAnswer = await prompt('Create this pool? (yes/no): ');
		if (confirmAnswer.toLowerCase() !== 'yes' && confirmAnswer.toLowerCase() !== 'y') {
			console.log('\n❌ Pool creation cancelled');
			process.exit(0);
		}

		// Execute pool creation
		console.log('\n🔄 Creating pool...');

		const gasLimit = Math.floor(gasEstimate * 1.2);

		const [receipt, , record] = await contractExecuteFunction(
			contractId,
			lazyLottoIface,
			client,
			gasLimit,
			'createPool',
			[name, symbol, memo, royalties, ticketCID, winCID, winRate, entryFee, feeToken],
			new Hbar(totalHbarNeeded, HbarUnit.Tinybar),
		);

		if (receipt.status.toString() !== 'SUCCESS') {
			console.error('\n❌ Transaction failed');
			console.error('Status:', receipt.status.toString());
			process.exit(1);
		}

		console.log('\n✅ Pool created successfully!');
		console.log(`📋 Transaction: ${record.transactionId.toString()}`);
		console.log('⏳ Waiting 5 seconds for mirror node to sync...\n');
		await sleep(5000);

		// Try to determine pool ID from events
		console.log('🔍 Fetching pool ID...');
		// Get the latest pool count to estimate pool ID
		const poolCount = await queryContract(env, contractId, lazyLottoIface, 'totalPools', [], operatorId);
		const estimatedPoolId = Number(poolCount[0]) - 1;
		// Last created pool

		console.log(`\n✅ Pool likely created with ID: #${estimatedPoolId}`);
		console.log('\n💡 Next steps:');
		console.log(`   1. Verify pool: node scripts/interactions/LazyLotto/queries/poolInfo.js ${estimatedPoolId}`);
		console.log('   2. Add prizes to your pool (admin function)');
		console.log('   3. Users can buy entries with buyEntry.js');
		console.log(`   4. Withdraw proceeds: node scripts/interactions/LazyLotto/user/withdraw-pool-proceeds.js --pool ${estimatedPoolId}\n`);

	}
	catch (error) {
		console.error('\n❌ Error creating pool:', error.message);
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
createCommunityPool();
