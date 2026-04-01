/**
 * LazyLotto Admin Buy and Redeem Entry Script
 *
 * Admin function to buy free entries for themselves and immediately redeem to NFTs.
 * Useful for testing, promotions, or creating example tickets.
 * Requires ADMIN role.
 *
 * Usage:
 *   Single-sig: node scripts/interactions/LazyLotto/admin/buyAndRedeemEntry.js
 *   Multi-sig:  node scripts/interactions/LazyLotto/admin/buyAndRedeemEntry.js --multisig
 *   Help:       node scripts/interactions/LazyLotto/admin/buyAndRedeemEntry.js --multisig-help
 *
 * Multi-sig options:
 *   --multisig                      Enable multi-signature mode
 *   --workflow=interactive|offline  Choose workflow (default: interactive)
 *   --export-only                   Just freeze and export (offline mode)
 *   --signatures=f1.json,f2.json    Execute with collected signatures
 *   --threshold=N                   Require N signatures
 *   --signers=Alice,Bob,Charlie     Label signers for clarity
 */

require('dotenv').config();
const { TokenId } = require('@hashgraph/sdk');
const { createClient, getEnvConfig, getContractId } = require('../../../../utils/clientFactory');
const { loadInterface } = require('../../../../utils/abiLoader');
const { prompt } = require('../../../../utils/promptHelpers');
const { queryContract } = require('../../../../utils/queryHelpers');
const { associateTokensToAccount } = require('../../../../utils/hederaHelpers');
const { homebrewPopulateAccountNum, EntityType, checkMirrorBalance } = require('../../../../utils/hederaMirrorHelpers');
const { estimateGas } = require('../../../../utils/gasHelpers');
const {
	executeContractFunction,
	checkMultiSigHelp,
	displayMultiSigBanner,
} = require('../../../../utils/scriptHelpers');

// Environment setup
const { operatorId, operatorKey, env } = getEnvConfig();
const contractId = getContractId('LAZY_LOTTO_CONTRACT_ID');

// Helper: Format win rate
function formatWinRate(thousandthsOfBps) {
	return (thousandthsOfBps / 1_000_000).toFixed(4) + '%';
}

async function buyAndRedeemEntry() {
	// Check for multi-sig help request
	if (checkMultiSigHelp()) {
		process.exit(0);
	}

	let client;

	try {
		// Initialize client
		client = createClient(env, operatorId, operatorKey);

		console.log('\n╔════════════════════════════════════════════════════════════╗');
		console.log('║     LazyLotto Admin Buy & Redeem Entry (Admin)            ║');
		console.log('╚════════════════════════════════════════════════════════════╝\n');
		console.log(`📍 Environment: ${env.toUpperCase()}`);
		console.log(`📄 Contract: ${contractId.toString()}`);
		console.log(`👤 Admin: ${operatorId.toString()}\n`);

		// Display multi-sig status if enabled
		displayMultiSigBanner();

		// Load contract ABI
		const lazyLottoIface = loadInterface('LazyLotto');

		// Get total pools
		const decoded = await queryContract(env, contractId, lazyLottoIface, 'totalPools', [], operatorId);
		const totalPools = Number(decoded[0]);

		if (totalPools === 0) {
			console.error('❌ No pools exist in the contract');
			process.exit(1);
		}

		console.log(`📊 Total pools: ${totalPools}\n`);

		// Get pool ID
		const poolIdStr = await prompt(`Enter pool ID (0-${totalPools - 1}): `);

		let poolId;
		try {
			poolId = parseInt(poolIdStr);
			if (isNaN(poolId) || poolId < 0 || poolId >= totalPools) {
				console.error(`❌ Pool ID must be between 0 and ${totalPools - 1}`);
				process.exit(1);
			}
		}
		catch {
			console.error('❌ Invalid pool ID format');
			process.exit(1);
		}

		// Get ticket count
		const ticketCountStr = await prompt('Enter number of tickets to create: ');

		let ticketCount;
		try {
			ticketCount = parseInt(ticketCountStr);
			if (isNaN(ticketCount) || ticketCount <= 0) {
				console.error('❌ Ticket count must be positive');
				process.exit(1);
			}
		}
		catch {
			console.error('❌ Invalid ticket count format');
			process.exit(1);
		}

		// Get pool token for association check
		const poolInfoResult = await queryContract(env, contractId, lazyLottoIface, 'getPoolBasicInfo', [poolId], operatorId);
		// eslint-disable-next-line no-unused-vars
		const [ticketCID, winCID, winRate, entryFee, prizeCount, outstanding, poolTokenId, paused, closed, feeToken] = poolInfoResult;

		if (paused) {
			console.error('\n❌ Pool is paused');
			process.exit(1);
		}

		if (closed) {
			console.error('\n❌ Pool is closed');
			process.exit(1);
		}

		// Get bonus calculation
		const boostResult = await queryContract(env, contractId, lazyLottoIface, 'calculateBoost', [operatorId.toSolidityAddress()], operatorId);
		const boost = boostResult[0];

		const baseWinRate = Number(winRate);
		const effectiveWinRate = Math.min(baseWinRate + Number(boost), 100_000_000);

		console.log('\n═══════════════════════════════════════════════════════════');
		console.log('  POOL DETAILS');
		console.log('═══════════════════════════════════════════════════════════');
		console.log(`  Base Win Rate:        ${formatWinRate(baseWinRate)}`);
		if (Number(boost) > 0) {
			console.log(`  Your Bonus:           +${formatWinRate(Number(boost))}`);
			console.log(`  Effective Win Rate:   ${formatWinRate(effectiveWinRate)}`);
		}
		console.log(`  Prize Packages:       ${prizeCount}`);
		console.log(`  Outstanding Entries:  ${outstanding}`);
		console.log('═══════════════════════════════════════════════════════════');
		console.log(`\n🎁 Admin privilege: Creating ${ticketCount} FREE NFT tickets`);

		// Associate pool token if needed
		const poolTokenHederaId = await homebrewPopulateAccountNum(env, poolTokenId, EntityType.TOKEN);
		const userBalance = await checkMirrorBalance(env, operatorId, poolTokenHederaId);

		if (userBalance === null) {
			console.log(`\n🔗 Associating pool NFT token (${poolTokenHederaId})...`);
			const result = await associateTokensToAccount(
				client,
				operatorId,
				operatorKey,
				[TokenId.fromString(poolTokenHederaId)],
			);

			if (result !== 'SUCCESS') {
				console.error('❌ Failed to associate pool token');
				process.exit(1);
			}
			console.log('✅ Pool token associated');
			console.log('⏳ Waiting 5 seconds for mirror node to sync...');
			await new Promise(resolve => setTimeout(resolve, 5000));
		}
		else {
			console.log(`\n✅ Pool token (${poolTokenHederaId}) already associated`);
		}

		console.log(`\n🎫 Creating ${ticketCount} free NFT tickets`);
		console.log(`   Pool: ${poolId}`);
		console.log(`   Recipient: ${operatorId.toString()} (admin)`);

		// Confirm
		const BUCKET_SIZE = 10;
		const bucketCount = Math.ceil(ticketCount / BUCKET_SIZE);
		console.log(`\n   Will mint in ${bucketCount} transaction(s) of up to ${BUCKET_SIZE} tickets each.`);
		const confirmAnswer = await prompt(`Create ${ticketCount} free NFT tickets? (yes/no): `);
		if (confirmAnswer.toLowerCase() !== 'yes' && confirmAnswer.toLowerCase() !== 'y') {
			console.log('\n❌ Operation cancelled');
			process.exit(0);
		}

		// Execute in buckets of BUCKET_SIZE
		console.log('\n🔄 Creating NFT tickets...\n');

		const allSerials = [];
		let minted = 0;

		for (let b = 0; b < bucketCount; b++) {
			const thisBatch = Math.min(BUCKET_SIZE, ticketCount - minted);
			process.stdout.write(`   Batch ${b + 1}/${bucketCount} (${thisBatch} tickets)...`);

			const gasInfo = await estimateGas(env, contractId, lazyLottoIface, operatorId, 'adminBuyAndRedeemEntry', [
				poolId,
				thisBatch,
			], 2_000_000);
			const gasLimit = Math.floor(gasInfo.gasLimit * 1.2);

			const executionResult = await executeContractFunction({
				contractId: contractId,
				iface: lazyLottoIface,
				client: client,
				functionName: 'adminBuyAndRedeemEntry',
				params: [poolId, thisBatch],
				gas: gasLimit,
				payableAmount: 0,
			});

			if (!executionResult.success) {
				console.log(' ❌');
				console.error(`\n⚠️  Failed at batch ${b + 1}: ${executionResult.error}`);
				console.log(`   ${minted} of ${ticketCount} tickets minted before failure.\n`);
				if (allSerials.length > 0) {
					console.log(`🎟️  Serials minted so far: ${allSerials.join(', ')}`);
				}
				throw new Error(executionResult.error || 'Transaction execution failed');
			}

			minted += thisBatch;

			// Try to decode serial numbers from this batch
			const { record } = executionResult;
			try {
				for (const log of (record.contractFunctionResult?.logs || [])) {
					try {
						const parsed = lazyLottoIface.parseLog({
							topics: log.topics,
							data: log.data,
						});
						if (parsed && parsed.name === 'TicketEvent') {
							const serials = parsed.args.serialNumber;
							for (const s of serials) allSerials.push(Number(s));
						}
					}
					catch { /* skip non-matching logs */ }
				}
			}
			catch { /* log parsing optional */ }

			console.log(' ✅');
		}

		console.log(`\n✅ All ${minted} NFT tickets created successfully!`);
		console.log(`🎫 Minted to ${operatorId.toString()}`);
		console.log(`   Pool: ${poolId}`);
		if (allSerials.length > 0) {
			console.log(`🎟️  Serial numbers: ${allSerials.join(', ')}`);
		}
		console.log('');

	}
	catch (error) {
		console.error('\n❌ Error creating tickets:', error.message);
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
buyAndRedeemEntry();
