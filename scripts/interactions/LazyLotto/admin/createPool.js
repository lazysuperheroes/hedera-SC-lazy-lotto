/**
 * LazyLotto Create Pool Script
 *
 * Creates a new lottery pool with specified parameters.
 * Requires ADMIN role on the contract.
 *
 * Usage:
 *   Single-sig: node scripts/interactions/LazyLotto/admin/createPool.js
 *   Multi-sig:  node scripts/interactions/LazyLotto/admin/createPool.js --multisig
 *   Help:       node scripts/interactions/LazyLotto/admin/createPool.js --multisig-help
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
const {
	Hbar,
	HbarUnit,
} = require('@hashgraph/sdk');
const { createClient, getEnvConfig, getContractId } = require('../../../../utils/clientFactory');
const { loadInterface } = require('../../../../utils/abiLoader');
const { prompt } = require('../../../../utils/promptHelpers');
const { queryContract } = require('../../../../utils/queryHelpers');
const { homebrewPopulateAccountNum, getTokenDetails } = require('../../../../utils/hederaMirrorHelpers');
const { estimateGas } = require('../../../../utils/gasHelpers');
const {
	executeContractFunction,
	checkMultiSigHelp,
	displayMultiSigBanner,
} = require('../../../../utils/scriptHelpers');

// Environment setup
const { operatorId, operatorKey, env } = getEnvConfig();
const contractId = getContractId('LAZY_LOTTO_CONTRACT_ID');
let tokenDets = null;

// Helper: Convert address formats
function convertToEvmAddress(hederaId) {
	if (hederaId.startsWith('0x')) return hederaId;
	const parts = hederaId.split('.');
	const num = parts[parts.length - 1];
	return '0x' + BigInt(num).toString(16).padStart(40, '0');
}

async function convertToHederaId(evmAddress) {
	if (!evmAddress.startsWith('0x')) return evmAddress;
	if (evmAddress === '0x0000000000000000000000000000000000000000') return 'HBAR';
	return await homebrewPopulateAccountNum(env, evmAddress);
}

// Helper: Format win rate
function formatWinRate(thousandthsOfBps) {
	return (thousandthsOfBps / 1_000_000).toFixed(4) + '%';
}

async function createPool() {
	// Check for multi-sig help request
	if (checkMultiSigHelp()) {
		process.exit(0);
	}

	let client;

	try {
		// Initialize client
		client = createClient(env, operatorId, operatorKey);

		console.log('\n╔════════════════════════════════════════════════════════════╗');
		console.log('║           LazyLotto Create Pool (Admin)                  ║');
		console.log('╚════════════════════════════════════════════════════════════╝\n');
		console.log(`📍 Environment: ${env.toUpperCase()}`);
		console.log(`📄 Contract: ${contractId.toString()}\n`);

		// Display multi-sig status if enabled
		displayMultiSigBanner();

		// Load contract ABI
		const lazyLottoIface = loadInterface('LazyLotto');

		// Check admin role
		console.log('🔍 Verifying admin role...');
		const userEvmAddress = '0x' + operatorId.toSolidityAddress();

		const hasAdminResult = await queryContract(env, contractId, lazyLottoIface, 'isAdmin', [userEvmAddress], operatorId);

		if (!hasAdminResult[0]) {
			console.error('❌ You do not have ADMIN role on this contract');
			process.exit(1);
		}

		console.log('✅ Admin role verified\n');

		// Gather pool parameters
		console.log('═══════════════════════════════════════════════════════════');
		console.log('  POOL CONFIGURATION');
		console.log('═══════════════════════════════════════════════════════════\n');

		// Win rate
		const winRateStr = await prompt('Enter win rate (as percentage, e.g., 5.25 for 5.25%): ');
		const winRatePercent = parseFloat(winRateStr);

		if (isNaN(winRatePercent) || winRatePercent <= 0 || winRatePercent > 100) {
			console.error('❌ Invalid win rate (must be 0-100)');
			process.exit(1);
		}

		const winRateThousandthsOfBps = Math.floor(winRatePercent * 1_000_000);

		// Entry fee token
		const feeTokenStr = await prompt('Enter fee token (0.0.xxxxx or "HBAR"): ');
		const feeToken = feeTokenStr.toUpperCase() === 'HBAR' ? '0x0000000000000000000000000000000000000000' : convertToEvmAddress(feeTokenStr);

		// Entry fee amount
		const entryFeeStr = await prompt('Enter entry fee amount: ');
		let entryFee = entryFeeStr;

		if (isNaN(Number(entryFee)) || Number(entryFee) <= 0) {
			console.error('❌ Invalid entry fee');
			process.exit(1);
		}

		// need to adjust entry fee by the appropriate decimal places based on token
		if (feeToken === '0x0000000000000000000000000000000000000000') {
			// HBAR: convert to tinybars
			entryFee = Math.floor(Number(new Hbar(Number(entryFee), HbarUnit.Hbar).toTinybars()));
		}
		else {
			// FT: get decimals and convert
			tokenDets = await getTokenDetails(env, feeTokenStr);
			entryFee = Math.floor(Number(entryFee) * (10 ** tokenDets.decimals));
		}

		// Create new pool NFT token or use existing
		const createNewToken = await prompt('Create new pool token? (yes/no): ');

		let tokenName, tokenSymbol, tokenMemo;

		if (createNewToken.toLowerCase() === 'yes' || createNewToken.toLowerCase() === 'y') {
			tokenName = await prompt('Enter token name: ');
			tokenSymbol = await prompt('Enter token symbol: ');
			tokenMemo = await prompt('Enter token memo (optional, press enter to skip): ') || 'LazyLotto Pool Token';

			console.log('\n💡 Note: Pool token creation requires ~40 HBAR fee\n');
		}
		else {
			console.error('❌ Only new token creation is supported. Use existing tokens for advanced scenarios.');
			process.exit(1);
		}

		// Get metadata CIDs
		const ticketCID = await prompt('Enter ticket metadata CID (for unrolled tickets): ');
		const winCID = await prompt('Enter winning ticket metadata CID: ');

		if (!ticketCID || !winCID) {
			console.error('❌ Both ticket CID and win CID are required');
			process.exit(1);
		}

		// Royalties (optional, max 10)
		const addRoyalties = await prompt('Add royalties? (yes/no): ');
		const royalties = [];

		if (addRoyalties.toLowerCase() === 'yes' || addRoyalties.toLowerCase() === 'y') {
			let addingRoyalties = true;

			while (addingRoyalties && royalties.length < 10) {
				console.log(`\n📝 Adding royalty ${royalties.length + 1}/10`);

				const royaltyAccount = await prompt('Enter royalty account (0.0.xxxxx): ');
				const royaltyPercentage = await prompt('Enter royalty percentage (e.g., 5 for 5%): ');
				const fallbackFeeHbar = await prompt('Enter fallback fee in HBAR (e.g., 1.5): ');

				const percentage = parseFloat(royaltyPercentage);
				const fallbackHbar = parseFloat(fallbackFeeHbar);

				if (isNaN(percentage) || percentage < 0 || percentage > 100) {
					console.error('❌ Invalid royalty percentage');
					continue;
				}

				if (isNaN(fallbackHbar) || fallbackHbar < 0) {
					console.error('❌ Invalid fallback fee');
					continue;
				}

				const numerator = Math.floor(percentage * 100);
				const denominator = 10000;
				const fallbackFeeTinybar = Math.floor(new Hbar(fallbackHbar, HbarUnit.Hbar).toTinybars());

				royalties.push({
					numerator: numerator,
					denominator: denominator,
					fallbackfee: fallbackFeeTinybar,
					account: convertToEvmAddress(royaltyAccount),
				});

				console.log(`✅ Added: ${percentage}% to ${royaltyAccount}, fallback: ${fallbackHbar} HBAR`);

				if (royalties.length < 10) {
					const addMore = await prompt('\nAdd another royalty? (yes/no): ');
					addingRoyalties = addMore.toLowerCase() === 'yes' || addMore.toLowerCase() === 'y';
				}
				else {
					console.log('\n⚠️  Maximum of 10 royalties reached');
					addingRoyalties = false;
				}
			}

			// Summarize royalties
			console.log('\n═══════════════════════════════════════════════════════════');
			console.log('  ROYALTY SUMMARY');
			console.log('═══════════════════════════════════════════════════════════');

			let totalRoyaltyPercentage = 0;
			royalties.forEach((royalty, index) => {
				const percentage = (royalty.numerator / royalty.denominator) * 100;
				const fallbackHbar = royalty.fallbackfee / 100_000_000;
				totalRoyaltyPercentage += percentage;

				console.log(`  ${index + 1}. ${percentage}% → ${royalty.account.substring(0, 10)}...`);
				console.log(`     Fallback: ${fallbackHbar} HBAR`);
			});

			console.log(`\n  Total Royalty: ${totalRoyaltyPercentage.toFixed(2)}%`);
			console.log('═══════════════════════════════════════════════════════════\n');

			if (totalRoyaltyPercentage > 100) {
				console.error('⚠️  WARNING: Total royalty percentage exceeds 100%!');
			}

			const confirmRoyalties = await prompt('Confirm royalties? (yes to continue, no to skip royalties): ');
			if (confirmRoyalties.toLowerCase() !== 'yes' && confirmRoyalties.toLowerCase() !== 'y') {
				royalties.length = 0;
				// Clear royalties array
				console.log('❌ Royalties cleared, continuing without royalties\n');
			}
		}

		// Summary
		console.log('═══════════════════════════════════════════════════════════');
		console.log('  POOL SUMMARY');
		console.log('═══════════════════════════════════════════════════════════');
		console.log(`  Pool Token:       ${tokenName} (${tokenSymbol})`);
		console.log(`  Win Rate:         ${formatWinRate(winRateThousandthsOfBps)}`);
		console.log(`  Entry Fee:        ${feeToken === '0x0000000000000000000000000000000000000000' ? new Hbar(Number(entryFee), HbarUnit.Tinybar).toString() : entryFee / (10 ** tokenDets.decimals) + ' ' + tokenDets.symbol}`);
		console.log(`  Ticket CID:       ${ticketCID}`);
		console.log(`  Win CID:          ${winCID}`);
		console.log(`  Royalties:        ${royalties.length > 0 ? 'Yes' : 'No'}`);
		console.log('═══════════════════════════════════════════════════════════\n');

		// Estimate gas
		console.log('⛽ Estimating gas...');

		const functionName = 'createPool';
		const functionArgs = [
			tokenName,
			tokenSymbol,
			tokenMemo,
			royalties,
			ticketCID,
			winCID,
			winRateThousandthsOfBps,
			entryFee,
			feeToken,
		];
		// 40 HBAR for token creation
		const payableAmountHbar = 40;
		const payableAmountTinybar = Number(new Hbar(payableAmountHbar).toTinybars());

		const gasInfo = await estimateGas(env, contractId, lazyLottoIface, operatorId, functionName, functionArgs, 800000, payableAmountTinybar);
		const gasEstimate = gasInfo.gasLimit;
		console.log(`   Gas: ~${gasEstimate}\n`);

		console.log('💰 Pool creation fee: 40 HBAR (for NFT token creation)\n');

		// Confirm
		const confirmAnswer = await prompt('Proceed with pool creation? (yes/no): ');
		if (confirmAnswer.toLowerCase() !== 'yes' && confirmAnswer.toLowerCase() !== 'y') {
			console.log('\n❌ Pool creation cancelled');
			process.exit(0);
		}

		// Execute
		console.log('\n🔄 Creating pool...');

		const gasLimit = Math.floor(gasEstimate * 1.2);

		const executionResult = await executeContractFunction({
			contractId: contractId,
			iface: lazyLottoIface,
			client: client,
			functionName: functionName,
			params: functionArgs,
			gas: gasLimit,
			payableAmount: payableAmountHbar,
		});

		if (!executionResult.success) {
			throw new Error(executionResult.error || 'Transaction execution failed');
		}

		const { receipt, results, record } = executionResult;

		console.log('\n✅ Pool created successfully!');
		const txId = receipt.transactionId?.toString() || record?.transactionId?.toString() || 'N/A';
		console.log(`📋 Transaction: ${txId}\n`);

		// Get the poolId from the contract function result
		// Note: results is already decoded by contractExecuteFunction
		let newPoolId;
		try {
			// The createPool function returns the poolId
			newPoolId = Number(results[0]);
			console.log(`🎰 New Pool ID: #${newPoolId}\n`);
		}
		catch (decodeError) {
			console.log('⚠️  Could not decode pool ID from transaction result');
			console.log('    Use the queries/masterInfo.js script to view all pools\n');

			console.log(decodeError);

			console.log('💡 Next steps:');
			console.log('   - Use addPrizePackage.js to add prizes to the pool');
			console.log('   - Users can buy entries once prizes are added\n');
			return;
		}

		// Wait a moment for mirror node to sync
		console.log('⏳ Waiting for mirror node to sync...');
		await new Promise(resolve => setTimeout(resolve, 3000));

		// Get pool details
		const verifyResult = await queryContract(env, contractId, lazyLottoIface, 'getPoolBasicInfo', [newPoolId], operatorId);
		const [, , verifyWinRate, verifyEntryFee, , , verifyPoolTokenId, , , verifyFeeToken] = verifyResult;

		// Format entry fee with proper decimals
		const verifyFeeTokenId = await convertToHederaId(verifyFeeToken);
		let formattedEntryFee;
		if (verifyFeeToken === '0x0000000000000000000000000000000000000000') {
			// HBAR
			formattedEntryFee = new Hbar(Number(verifyEntryFee), HbarUnit.Tinybar).toString();
		}
		else {
			// FT - get token details for decimals
			const verifyTokenDets = await getTokenDetails(env, verifyFeeTokenId);
			formattedEntryFee = `${Number(verifyEntryFee) / (10 ** verifyTokenDets.decimals)} ${verifyTokenDets.symbol}`;
		}

		console.log('═══════════════════════════════════════════════════════════');
		console.log('  NEW POOL DETAILS');
		console.log('═══════════════════════════════════════════════════════════');
		console.log(`  Pool ID:          #${newPoolId}`);
		console.log(`  Win Rate:         ${formatWinRate(Number(verifyWinRate))}`);
		console.log(`  Entry Fee:        ${formattedEntryFee}`);
		console.log(`  Pool Token:       ${await convertToHederaId(verifyPoolTokenId)}`);
		console.log('  State:            ACTIVE');
		console.log('═══════════════════════════════════════════════════════════\n');

		console.log('💡 Next steps:');
		console.log('   - Use addPrizePackage.js to add prizes to the pool');
		console.log('   - Users can buy entries once prizes are added\n');

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
createPool();
