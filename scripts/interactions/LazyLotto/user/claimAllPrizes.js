/**
 * LazyLotto Claim All Prizes Script
 *
 * Claims all pending prizes at once.
 * Convenience function that internally calls claimPrize for each pending prize.
 *
 * Usage: node scripts/interactions/LazyLotto/user/claimAllPrizes.js
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
const { associateTokensToAccount, setHbarAllowance } = require('../../../../utils/hederaHelpers');

// Environment setup
const { operatorId, operatorKey, env } = getEnvConfig();
const contractId = getContractId('LAZY_LOTTO_CONTRACT_ID');
const storageContractId = getContractId('LAZY_LOTTO_STORAGE');

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

async function claimAllPrizes() {
	let client;

	try {
		// Initialize client
		client = createClient(env, operatorId, operatorKey);

		console.log('\n╔════════════════════════════════════════════════════════════╗');
		console.log('║            LazyLotto Claim All Prizes                     ║');
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

			console.log(`  Prize #${i}:`);
			console.log(`    Pool:     #${pendingPrize.poolId}`);
			console.log(`    Format:   ${pendingPrize.asNFT ? 'Prize NFT' : 'Memory'}`);

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

			console.log(`    Contents: ${prizeItems.join(' + ')}`);
			console.log();
		}

		console.log('═══════════════════════════════════════════════════════════\n');

		// Check and associate required tokens for all prizes
		console.log('🔍 Checking token associations...');
		const tokensToAssociate = new Set();
		let hasNFTs = false;
		const { checkMirrorBalance } = require('../../../../utils/hederaMirrorHelpers');

		for (const pendingPrize of pendingPrizes[0]) {
			const prize = pendingPrize.prize;

			// Check FT token
			if (prize.amount > 0 && prize.token !== '0x0000000000000000000000000000000000000000') {
				const ftTokenId = await convertToHederaId(prize.token);
				const ftBalance = await checkMirrorBalance(env, operatorId, ftTokenId);
				if (ftBalance === null) {
					tokensToAssociate.add(ftTokenId);
				}
			}

			// Check NFT tokens
			const nftTokens = prize.nftTokens.filter(t => t !== '0x0000000000000000000000000000000000000000');
			if (nftTokens.length > 0) {
				hasNFTs = true;
				for (const nftToken of nftTokens) {
					const nftTokenId = await convertToHederaId(nftToken);
					const nftBalance = await checkMirrorBalance(env, operatorId, nftTokenId);
					if (nftBalance === null) {
						tokensToAssociate.add(nftTokenId);
					}
				}
			}
		}

		// Associate tokens if needed
		if (tokensToAssociate.size > 0) {
			console.log(`\n🔗 Associating ${tokensToAssociate.size} token(s)...`);
			const tokenIds = Array.from(tokensToAssociate).map(id => TokenId.fromString(id));
			const associateResult = await associateTokensToAccount(
				client,
				operatorId,
				operatorKey,
				tokenIds,
			);

			if (associateResult !== 'SUCCESS') {
				console.error('❌ Failed to associate tokens');
				process.exit(1);
			}
			console.log('Tokens associated successfully');
			console.log('⏳ Waiting 5 seconds for mirror node to sync...');
			await new Promise(resolve => setTimeout(resolve, 5000));
		}
		else {
			console.log('All required tokens already associated');
		}

		// Check HBAR allowance if any prize contains NFTs
		if (hasNFTs) {
			console.log('\n🔍 Checking HBAR allowance for NFT transfers...');
			const { checkMirrorHbarAllowance } = require('../../../../utils/hederaMirrorHelpers');
			const hbarAllowance = await checkMirrorHbarAllowance(env, operatorId, storageContractId);
			// 1 HBAR should be sufficient
			const requiredHbar = 1;

			if (!hbarAllowance || hbarAllowance < requiredHbar) {
				console.log(`🔗 Setting HBAR allowance (${requiredHbar} HBAR) to storage contract...`);
				const allowanceResult = await setHbarAllowance(
					client,
					operatorId,
					storageContractId,
					requiredHbar,
					HbarUnit.Hbar,
				);

				if (allowanceResult !== 'SUCCESS') {
					console.error('❌ Failed to set HBAR allowance');
					process.exit(1);
				}
				console.log('HBAR allowance set successfully');
			}
			else {
				console.log(`✅ HBAR allowance already set (${hbarAllowance} HBAR)`);
			}
		}

		console.log('');

		// Estimate gas
		const gasInfo = await estimateGas(env, contractId, lazyLottoIface, operatorId, 'claimAllPrizes', [], 1000000);
		const gasEstimate = gasInfo.gasLimit;

		// Confirm claim
		const confirmAnswer = await prompt(`Claim all ${pendingPrizes[0].length} prize(s)? (yes/no): `);
		if (confirmAnswer.toLowerCase() !== 'yes' && confirmAnswer.toLowerCase() !== 'y') {
			console.log('\n❌ Claim cancelled');
			process.exit(0);
		}

		// Execute claim
		console.log('\n🔄 Claiming all prizes...');

		const gasLimit = Math.floor(gasEstimate * 1.2);

		const [receipt, , record] = await contractExecuteFunction(
			contractId,
			lazyLottoIface,
			client,
			gasLimit,
			'claimAllPrizes',
			[],
		);

		if (receipt.status.toString() !== 'SUCCESS') {
			console.error('\n❌ Transaction failed');
			process.exit(1);
		}

		console.log('\n✅ All prizes claimed successfully!');
		console.log(`📋 Transaction: ${record.transactionId.toString()}\n`);

		console.log('🎉 All prizes have been transferred to your account!\n');

	}
	catch (error) {
		console.error('\n❌ Error claiming prizes:', error.message);
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
claimAllPrizes();
