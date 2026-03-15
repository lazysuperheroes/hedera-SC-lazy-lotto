/**
 * LazyLotto Check NFT Prize Script
 *
 * Query what prize a specific NFT serial represents.
 * Returns the pool ID and prize details for the given NFT.
 *
 * Usage: node scripts/interactions/LazyLotto/queries/checkNFTPrize.js <tokenId> <serial>
 */

require('dotenv').config();
const {
	Hbar,
	HbarUnit,
} = require('@hashgraph/sdk');
const { createClient, getEnvConfig, getContractId } = require('../../../../utils/clientFactory');
const { loadInterface } = require('../../../../utils/abiLoader');
const { queryContract } = require('../../../../utils/queryHelpers');
const { prompt } = require('../../../../utils/promptHelpers');

const { getTokenDetails, homebrewPopulateAccountNum, EntityType } = require('../../../../utils/hederaMirrorHelpers');

// Environment setup
const { operatorId, operatorKey, env } = getEnvConfig();
const contractId = getContractId('LAZY_LOTTO_CONTRACT_ID');

// Helper: Convert EVM address to Hedera ID
async function convertToHederaId(evmAddress, entityType = null) {
	if (!evmAddress.startsWith('0x')) return evmAddress;
	if (evmAddress === '0x0000000000000000000000000000000000000000') return 'HBAR';
	return await homebrewPopulateAccountNum(env, evmAddress, entityType);
}

// Helper: Convert Hedera ID to EVM address
function convertToEvmAddress(hederaId) {
	if (hederaId.startsWith('0x')) return hederaId;
	const parts = hederaId.split('.');
	const num = parts[parts.length - 1];
	return '0x' + BigInt(num).toString(16).padStart(40, '0');
}

async function checkNFTPrize() {
	let client;

	try {
		// Get parameters
		let tokenIdStr = process.argv[2];
		let serialStr = process.argv[3];

		if (!tokenIdStr) {
			tokenIdStr = await prompt('Enter NFT token ID (0.0.xxxxx): ');
		}

		if (!serialStr) {
			serialStr = await prompt('Enter serial number: ');
		}

		const serialNumber = parseInt(serialStr);

		if (isNaN(serialNumber) || serialNumber <= 0) {
			console.error('❌ Invalid serial number');
			process.exit(1);
		}

		// Initialize client
		client = createClient(env, operatorId, operatorKey);

		console.log('\n╔════════════════════════════════════════════════════════════╗');
		console.log('║         LazyLotto Check NFT Prize Query                   ║');
		console.log('╚════════════════════════════════════════════════════════════╝\n');
		console.log(`📍 Environment: ${env.toUpperCase()}`);
		console.log(`📄 Contract: ${contractId.toString()}`);
		console.log(`🎫 Checking: ${tokenIdStr} serial #${serialNumber}\n`);

		// Load contract ABI
		const lazyLottoIface = loadInterface('LazyLotto');

		// Convert token ID to EVM format
		const tokenEvmAddress = convertToEvmAddress(tokenIdStr);

		// Query the NFT prize data
		console.log('🔍 Querying NFT prize data...\n');

		const pendingPrize = (await queryContract(env, contractId, lazyLottoIface, 'getPendingPrizesByNFT', [tokenEvmAddress, serialNumber], operatorId))[0];

		// Check if this NFT represents a prize
		if (!pendingPrize.asNFT) {
			console.log('═══════════════════════════════════════════════════════════');
			console.log('  NFT STATUS');
			console.log('═══════════════════════════════════════════════════════════');
			console.log('  ❌ This NFT is NOT a prize NFT');
			console.log('     It may be:');
			console.log('     • A regular ticket NFT (not yet rolled)');
			console.log('     • An NFT from outside the lottery system');
			console.log('═══════════════════════════════════════════════════════════\n');
			process.exit(0);
		}

		// Get token details
		let tokenSymbol = tokenIdStr;
		try {
			const tokenDetails = await getTokenDetails(env, tokenIdStr);
			tokenSymbol = tokenDetails.symbol || tokenIdStr;
		}
		catch {
			// Use tokenId as fallback
		}

		// Display prize information
		console.log('═══════════════════════════════════════════════════════════');
		console.log('  NFT PRIZE INFORMATION');
		console.log('═══════════════════════════════════════════════════════════');
		console.log(`  Token:       ${tokenSymbol} (${tokenIdStr})`);
		console.log(`  Serial:      #${serialNumber}`);
		console.log(`  Pool:        #${pendingPrize.poolId}`);
		console.log('  Status:      🎁 PRIZE NFT');
		console.log('═══════════════════════════════════════════════════════════\n');

		const prize = pendingPrize.prize;

		console.log('═══════════════════════════════════════════════════════════');
		console.log('  PRIZE CONTENTS');
		console.log('═══════════════════════════════════════════════════════════');

		const prizeItems = [];

		// FT/HBAR amount
		if (prize.amount > 0) {
			const tokenId = prize.token === '0x0000000000000000000000000000000000000000'
				? 'HBAR'
				: await convertToHederaId(prize.token, EntityType.TOKEN);

			let formattedAmount;
			if (tokenId === 'HBAR') {
				formattedAmount = new Hbar(Number(prize.amount), HbarUnit.Tinybar).toString();
			}
			else {
				const tokenDets = await getTokenDetails(env, tokenId);
				formattedAmount = `${Number(prize.amount) / (10 ** tokenDets.decimals)} ${tokenDets.symbol}`;
			}
			prizeItems.push(formattedAmount);
		}

		// NFTs
		if (prize.nftTokens.length > 0) {
			const nftTokens = prize.nftTokens.filter(t => t !== '0x0000000000000000000000000000000000000000');
			if (nftTokens.length > 0) {
				const totalSerials = prize.nftSerials.reduce((sum, arr) => sum + arr.length, 0);
				prizeItems.push(`${totalSerials} NFT${totalSerials !== 1 ? 's' : ''}`);
			}
		}

		console.log(`  Summary:     ${prizeItems.join(' + ')}\n`);

		// Show detailed NFT breakdown
		if (prize.nftTokens.length > 0) {
			console.log('  NFT Details:');
			for (let j = 0; j < prize.nftTokens.length; j++) {
				const nftAddr = prize.nftTokens[j];
				if (nftAddr === '0x0000000000000000000000000000000000000000') continue;

				const nftTokenId = await convertToHederaId(nftAddr, EntityType.TOKEN);
				const serials = prize.nftSerials[j].map(s => Number(s));
				const serialsStr = serials.join(', ');

				try {
					const nftDets = await getTokenDetails(env, nftTokenId);
					console.log(`    • ${nftDets.symbol} (${nftTokenId}): serials [${serialsStr}]`);
				}
				catch {
					console.log(`    • ${nftTokenId}: serials [${serialsStr}]`);
				}
			}
		}

		console.log('═══════════════════════════════════════════════════════════\n');

		console.log('📌 This NFT can be claimed using:');
		console.log('   • claimPrize.js (claim to wallet)');
		console.log('   • Or transfer the NFT to someone else first\n');

		console.log('✅ NFT prize query complete!\n');

	}
	catch (error) {
		console.error('\n❌ Error checking NFT prize:', error.message);
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
checkNFTPrize();
