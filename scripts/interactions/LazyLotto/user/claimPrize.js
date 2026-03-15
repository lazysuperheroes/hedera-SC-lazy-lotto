/**
 * LazyLotto Claim Prize Script
 *
 * Claim a single pending prize (memory or NFT format).
 *
 * Usage: node scripts/interactions/LazyLotto/user/claimPrize.js [prizeIndex]
 */

require('dotenv').config();
const {
	TokenId,
	HbarUnit,
} = require('@hashgraph/sdk');
const { createClient, getEnvConfig, getContractId } = require('../../../../utils/clientFactory');
const { loadInterface } = require('../../../../utils/abiLoader');
const { prompt } = require('../../../../utils/promptHelpers');
const { queryContract } = require('../../../../utils/queryHelpers');
const { setHbarAllowance, associateTokensToAccount } = require('../../../../utils/hederaHelpers');
const { sleep } = require('../../../../utils/nodeHelpers');

// Environment setup
const { operatorId, operatorKey, env } = getEnvConfig();
const contractId = getContractId('LAZY_LOTTO_CONTRACT_ID');
const storageContractId = getContractId('LAZY_LOTTO_STORAGE');

// Helper: Convert Hedera ID to EVM address
async function convertToHederaId(evmAddress) {
	if (!evmAddress.startsWith('0x')) return evmAddress;
	if (evmAddress === '0x0000000000000000000000000000000000000000') return 'HBAR';
	const { homebrewPopulateAccountNum } = require('../../../../utils/hederaMirrorHelpers');
	return await homebrewPopulateAccountNum(env, evmAddress);
}

// Helper: Format HBAR
function formatHbar(tinybars) {
	return (Number(tinybars) / 100_000_000).toFixed(8) + ' ℏ';
}

async function claimPrize() {
	let client;

	try {
		// Get prize index
		let prizeIndexStr = process.argv[2];

		// Initialize client
		client = createClient(env, operatorId, operatorKey);

		console.log('\n╔════════════════════════════════════════════════════════════╗');
		console.log('║              LazyLotto Claim Prize                        ║');
		console.log('╚════════════════════════════════════════════════════════════╝\n');
		console.log(`📍 Environment: ${env.toUpperCase()}`);
		console.log(`📄 Contract: ${contractId.toString()}\n`);

		// Load contract ABI
		const lazyLottoIface = loadInterface('LazyLotto');

		// Import helpers
		const { contractExecuteFunction } = require('../../../../utils/solidityHelpers');
		const { estimateGas } = require('../../../../utils/gasHelpers');

		console.log('🔍 Fetching your pending prizes...\n');

		// Get pending prizes
		const userEvmAddress = '0x' + operatorId.toSolidityAddress();
		// Get pending prizes count first
		const countResult = await queryContract(env, contractId, lazyLottoIface, 'getPendingPrizesCount', [userEvmAddress], operatorId);
		const prizeCount = countResult[0];

		// Get all pending prizes
		const pendingPrizes = await queryContract(env, contractId, lazyLottoIface, 'getPendingPrizesPage', [userEvmAddress, 0, Number(prizeCount)], operatorId);

		if (pendingPrizes[0].length === 0) {
			console.log('❌ You have no pending prizes to claim\n');
			process.exit(0);
		}

		console.log(`✅ You have ${pendingPrizes[0].length} pending prize(s)\n`);

		// Display prizes
		console.log('═══════════════════════════════════════════════════════════');
		console.log('  YOUR PENDING PRIZES');
		console.log('═══════════════════════════════════════════════════════════');

		for (let i = 0; i < pendingPrizes[0].length; i++) {
			const pendingPrize = pendingPrizes[0][i];
			const prize = pendingPrize.prize;

			console.log(`  [${i}] Pool #${pendingPrize.poolId}`);
			console.log(`      Format: ${pendingPrize.asNFT ? 'Prize NFT' : 'Memory'}`);

			const prizeItems = [];
			if (prize.amount > 0) {
				const tokenId = await convertToHederaId(prize.token);
				prizeItems.push(tokenId === 'HBAR' ? formatHbar(prize.amount) : `${prize.amount} ${tokenId}`);
			}
			if (prize.nftTokens.length > 0) {
				const nftTokens = prize.nftTokens.filter(t => t !== '0x0000000000000000000000000000000000000000');
				if (nftTokens.length > 0) {
					prizeItems.push(`${prize.nftSerials.length} NFT(s)`);
				}
			}

			console.log(`      Contents: ${prizeItems.join(' + ')}`);
			console.log();
		}

		console.log('═══════════════════════════════════════════════════════════\n');

		// Get prize index to claim
		if (!prizeIndexStr) {
			prizeIndexStr = await prompt(`Enter prize index to claim (0-${pendingPrizes[0].length - 1}): `);
		}

		const prizeIndex = parseInt(prizeIndexStr);

		if (isNaN(prizeIndex) || prizeIndex < 0 || prizeIndex >= pendingPrizes[0].length) {
			console.error(`❌ Invalid prize index (must be 0-${pendingPrizes[0].length - 1})`);
			process.exit(1);
		}

		const selectedPrize = pendingPrizes[0][prizeIndex];
		const prize = selectedPrize.prize;

		console.log('═══════════════════════════════════════════════════════════');
		console.log('  CLAIMING PRIZE');
		console.log('═══════════════════════════════════════════════════════════');
		console.log(`  Index:    ${prizeIndex}`);
		console.log(`  Pool:     #${selectedPrize.poolId}`);
		console.log(`  Format:   ${selectedPrize.asNFT ? 'Prize NFT' : 'Memory'}`);

		const prizeItems = [];
		if (prize.amount > 0) {
			const tokenId = await convertToHederaId(prize.token);
			prizeItems.push(tokenId === 'HBAR' ? formatHbar(prize.amount) : `${prize.amount} ${tokenId}`);
		}
		if (prize.nftTokens.length > 0) {
			const nftTokens = prize.nftTokens.filter(t => t !== '0x0000000000000000000000000000000000000000');
			if (nftTokens.length > 0) {
				prizeItems.push(`${prize.nftSerials.length} NFT(s)`);
			}
		}

		console.log(`  Contents: ${prizeItems.join(' + ')}`);
		console.log('═══════════════════════════════════════════════════════════\n');

		// Check and associate required tokens
		console.log('🔍 Checking token associations...');
		const tokensToAssociate = [];
		const { checkMirrorBalance } = require('../../../../utils/hederaMirrorHelpers');

		// Check FT token
		if (prize.amount > 0 && prize.token !== '0x0000000000000000000000000000000000000000') {
			const ftTokenId = await convertToHederaId(prize.token);
			const ftBalance = await checkMirrorBalance(env, operatorId, ftTokenId);
			if (ftBalance === null) {
				console.log(`  🔗 FT token ${ftTokenId} needs association`);
				tokensToAssociate.push(TokenId.fromString(ftTokenId));
			}
		}

		// Check NFT tokens
		const nftTokens = prize.nftTokens.filter(t => t !== '0x0000000000000000000000000000000000000000');
		for (const nftToken of nftTokens) {
			const nftTokenId = await convertToHederaId(nftToken);
			const nftBalance = await checkMirrorBalance(env, operatorId, nftTokenId);
			if (nftBalance === null) {
				console.log(`  🔗 NFT token ${nftTokenId} needs association`);
				tokensToAssociate.push(TokenId.fromString(nftTokenId));
			}
		}

		// Associate tokens if needed
		if (tokensToAssociate.length > 0) {
			console.log(`\n🔗 Associating ${tokensToAssociate.length} token(s)...`);
			const associateTx = await associateTokensToAccount(
				client,
				operatorId,
				operatorKey,
				tokensToAssociate,
			);
			if (associateTx.status.toString() !== 'SUCCESS') {
				console.error('❌ Failed to associate tokens');
				process.exit(1);
			}
		}
		else {
			console.log('✅ All required tokens already associated');
		}

		// Check HBAR allowance if prize contains NFTs
		if (nftTokens.length > 0) {
			console.log('\n🔍 Checking HBAR allowance for NFT transfers...');
			const { checkMirrorHbarAllowance } = require('../../../../utils/hederaMirrorHelpers');
			const hbarAllowance = await checkMirrorHbarAllowance(env, operatorId, storageContractId);
			const requiredHbar = nftTokens.length;

			if (!hbarAllowance || hbarAllowance < requiredHbar) {
				console.log(`🔗 Setting HBAR allowance (${requiredHbar} HBAR) to storage contract...`);
				const allowanceTx = await setHbarAllowance(
					client,
					operatorId,
					storageContractId,
					requiredHbar,
					HbarUnit.Hbar,
				);

				if (allowanceTx.status.toString() !== 'SUCCESS') {
					console.error('❌ Failed to set HBAR allowance');
					process.exit(1);
				}
			}
			else {
				console.log(`✅ HBAR allowance already set (${hbarAllowance} HBAR)`);
			}
		}

		// Estimate gas
		const gasInfo = await estimateGas(env, contractId, lazyLottoIface, operatorId, 'claimPrize', [prizeIndex], 500000);
		const gasEstimate = gasInfo.gasLimit;

		// Confirm claim
		const confirmAnswer = await prompt('Proceed with claim? (yes/no): ');
		if (confirmAnswer.toLowerCase() !== 'yes' && confirmAnswer.toLowerCase() !== 'y') {
			console.log('\n❌ Claim cancelled');
			process.exit(0);
		}

		// Execute claim
		console.log('\n🔄 Claiming prize...');

		const gasLimit = Math.floor(gasEstimate * 1.2);

		const [receipt, , record] = await contractExecuteFunction(
			contractId,
			lazyLottoIface,
			client,
			gasLimit,
			'claimPrize',
			[prizeIndex],
		);

		if (receipt.status.toString() !== 'SUCCESS') {
			console.error('\n❌ Transaction failed');
			process.exit(1);
		}

		console.log('\n✅ Prize claimed successfully!');
		console.log(`📋 Transaction: ${record.transactionId.toString()}\n`);

		console.log('🔍 Waiting on sync to fetch updated pending prizes...\n');
		await sleep(5000);
		// Get updated pending prizes
		const newCountResult = await queryContract(env, contractId, lazyLottoIface, 'getPendingPrizesCount', [userEvmAddress], operatorId);
		const newPrizeCount = newCountResult[0];

		const newPendingPrizes = await queryContract(env, contractId, lazyLottoIface, 'getPendingPrizesPage', [userEvmAddress, 0, Number(newPrizeCount)], operatorId);

		console.log('═══════════════════════════════════════════════════════════');
		console.log('  UPDATED STATE');
		console.log('═══════════════════════════════════════════════════════════');
		console.log(`  Remaining pending prizes: ${newPendingPrizes[0].length}`);
		console.log('═══════════════════════════════════════════════════════════\n');

		if (newPendingPrizes[0].length > 0) {
			console.log('💡 You still have prizes to claim!');
			console.log('   Use claimAllPrizes.js to claim them all at once\n');
		}
		else {
			console.log('🎉 All prizes claimed!\n');
		}

	}
	catch (error) {
		console.error('\n❌ Error claiming prize:', error.message);
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
claimPrize();
