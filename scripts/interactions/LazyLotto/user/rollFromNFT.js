/**
 * LazyLotto Roll From NFT Script
 *
 * Roll NFT tickets directly (redeems NFT to memory and rolls in one transaction).
 * This is the counterpart to redeemEntriesToNFT.js - it burns NFT tickets and plays them.
 *
 * Uses 2x gas multiplier due to PRNG uncertainty.
 *
 * Usage: node scripts/interactions/LazyLotto/user/rollFromNFT.js [poolId] [serialNumber1,serialNumber2,...]
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

async function rollFromNFT() {
	let client;

	try {
		// Get parameters
		let poolIdStr = process.argv[2];
		const serialsInput = process.argv[3];

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
		console.log('║          LAZY LOTTO - ROLL FROM NFT TICKETS              ║');
		console.log('╚════════════════════════════════════════════════════════════╝\n');
		console.log(`Network:       ${env.toUpperCase()}`);
		console.log(`Account:       ${operatorId.toString()}`);
		console.log(`Contract:      ${contractId.toString()}`);
		console.log(`Pool ID:       ${poolId}\n`);

		// Load contract ABI
		const iface = loadInterface('LazyLotto');

		// Import helpers
		const { getSerialsOwned, getTokenDetails } = require('../../../../utils/hederaMirrorHelpers');

		console.log('📊 Fetching pool details...\n');

		// Get pool basic info
		// eslint-disable-next-line no-unused-vars
		const [ticketCID, winCID, winRate, entryFee, prizeCount, outstanding, poolTokenIdEvm, paused, closed, feeToken] =
			await queryContract(env, contractId, iface, 'getPoolBasicInfo', [poolId], operatorId);

		if (closed) {
			console.error('❌ Pool is closed');
			process.exit(1);
		}

		if (paused) {
			console.error('❌ Pool is paused');
			process.exit(1);
		}

		// Convert pool token ID from EVM address to Hedera ID
		const poolTokenId = await convertToHederaId(poolTokenIdEvm);

		// Get user's boost (includes NFT boost + LAZY balance boost)
		const userEvmAddress = `0x${operatorId.toSolidityAddress()}`;
		const boostBps = await queryContract(env, contractId, iface, 'calculateBoost', [userEvmAddress], operatorId);

		const baseWinRate = Number(winRate);
		const userBoost = Number(boostBps[0]);
		const effectiveWinRate = baseWinRate + userBoost;

		console.log('═══════════════════════════════════════════════════════════');
		console.log('  POOL INFORMATION');
		console.log('═══════════════════════════════════════════════════════════');
		console.log(`  Pool ID:           ${poolId}`);
		console.log(`  Pool Token:        ${poolTokenId}`);
		console.log(`  Base Win Rate:     ${formatWinRate(baseWinRate)}`);
		console.log(`  Your Boost:        +${formatWinRate(userBoost)}`);
		console.log(`  Effective Rate:    ${formatWinRate(effectiveWinRate)}`);
		console.log('═══════════════════════════════════════════════════════════\n');

		// Query user's owned NFT serials for this pool
		console.log('🔍 Checking your NFT tickets...\n');

		const ownedSerials = await getSerialsOwned(env, operatorId.toString(), poolTokenId);

		if (!ownedSerials || ownedSerials.length === 0) {
			console.log('❌ You don\'t own any NFT tickets for this pool.');
			console.log('   Use redeemEntriesToNFT.js to convert memory entries to NFT tickets first.\n');
			process.exit(0);
		}

		console.log(`✅ You own ${ownedSerials.length} NFT ticket(s): ${ownedSerials.join(', ')}\n`);

		// Parse serial numbers to roll
		let serialsToRoll;

		if (serialsInput) {
			// Parse comma-separated serials from CLI
			serialsToRoll = serialsInput.split(',').map(s => {
				const serial = parseInt(s.trim());
				if (isNaN(serial) || serial <= 0) {
					console.error(`❌ Invalid serial number: ${s}`);
					process.exit(1);
				}
				// Validate user owns this serial
				if (!ownedSerials.includes(serial)) {
					console.error(`❌ You don't own serial #${serial}`);
					process.exit(1);
				}
				return serial;
			});
		}
		else {
			// Interactive selection
			const choice = await prompt(`Do you want to roll ALL ${ownedSerials.length} ticket(s)? (y/n): `);

			if (choice.toLowerCase() === 'y') {
				serialsToRoll = ownedSerials;
			}
			else {
				const serialsStr = await prompt('Enter serial numbers to roll (comma-separated): ');
				serialsToRoll = serialsStr.split(',').map(s => {
					const serial = parseInt(s.trim());
					if (isNaN(serial) || serial <= 0) {
						console.error(`❌ Invalid serial number: ${s}`);
						process.exit(1);
					}
					if (!ownedSerials.includes(serial)) {
						console.error(`❌ You don't own serial #${serial}`);
						process.exit(1);
					}
					return serial;
				});
			}
		}

		if (serialsToRoll.length === 0) {
			console.log('❌ No serials selected to roll.');
			process.exit(0);
		}

		console.log(`\n🎲 Rolling ${serialsToRoll.length} NFT ticket(s): ${serialsToRoll.join(', ')}\n`);

		// Confirm action
		const confirmAnswer = await prompt('Proceed with rolling? (y/n): ');
		if (confirmAnswer.toLowerCase() !== 'y') {
			console.log('Operation cancelled.');
			process.exit(0);
		}

		// Estimate gas (2x multiplier for PRNG uncertainty)
		console.log('\n⚡ Estimating gas (2x multiplier for rolls)...');

		const { estimateGas } = require('../../../../utils/gasHelpers');

		const gasInfo = await estimateGas(
			env,
			contractId,
			iface,
			operatorId,
			'rollWithNFT',
			[poolId, serialsToRoll],
			400_000 + 75_000 * serialsToRoll.length,
			0,
		);
		const baseGas = gasInfo.gasLimit;
		const gasWithMultiplier = Math.floor(baseGas * 2);
		const gasLimit = Math.floor(gasWithMultiplier * 1.2);

		console.log(`   Base estimate: ${baseGas} gas`);
		console.log(`   With 2x multiplier: ${gasWithMultiplier} gas`);
		console.log(`   With 20% buffer: ${gasLimit} gas\n`);

		// Execute rollWithNFT
		console.log('🎲 Rolling NFT tickets...\n');

		const { contractExecuteFunction } = require('../../../../utils/solidityHelpers');

		const [, results, record] = await contractExecuteFunction(
			contractId,
			iface,
			client,
			gasLimit,
			'rollWithNFT',
			[poolId, serialsToRoll],
			0,
		);

		console.log('✅ Transaction successful!');
		console.log(`   Transaction ID: ${record.transactionId.toString()}\n`);

		// Decode results - results is already decoded by contractExecuteFunction
		let wins = 0;
		let offset = 0;

		if (results && results.length >= 2) {
			wins = Number(results[0]);
			offset = Number(results[1]);

			// Calculate actual win rate
			const ticketCount = serialsToRoll.length;
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
				console.log('🎉 Congratulations! You won prizes!\n');
				console.log('🔍 Fetching your prizes...\n');

				// Fetch the actual prizes won using the offset
				const wonPrizes = await queryContract(env, contractId, iface, 'getPendingPrizesPage', [userEvmAddress, offset, wins], operatorId);

				if (wonPrizes && wonPrizes[0] && wonPrizes[0].length > 0) {
					console.log('═══════════════════════════════════════════════════════════');
					console.log('  YOUR PRIZES');
					console.log('═══════════════════════════════════════════════════════════');

					for (let i = 0; i < wonPrizes[0].length; i++) {
						const pendingPrize = wonPrizes[0][i];
						const prize = pendingPrize.prize;
						const prizeIndex = offset + i;

						console.log(`\n  Prize #${prizeIndex}:`);
						console.log(`    As NFT:   ${pendingPrize.asNFT ? 'Yes' : 'No'}`);

						const prizeItems = [];
						if (prize.amount > 0) {
							const tokenId = prize.token === '0x0000000000000000000000000000000000000000'
								? 'HBAR'
								: await convertToHederaId(prize.token);

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
						if (prize.nftTokens.length > 0) {
							const nftTokens = prize.nftTokens.filter(t => t !== '0x0000000000000000000000000000000000000000');
							if (nftTokens.length > 0) {
								const totalSerials = prize.nftSerials.reduce((sum, arr) => sum + arr.length, 0);
								prizeItems.push(`${totalSerials} NFT${totalSerials !== 1 ? 's' : ''}`);
							}
						}

						console.log(`    Contents: ${prizeItems.join(' + ')}`);

						// Show NFT details
						if (prize.nftTokens.length > 0) {
							for (let j = 0; j < prize.nftTokens.length; j++) {
								const nftAddr = prize.nftTokens[j];
								if (nftAddr === '0x0000000000000000000000000000000000000000') continue;

								const nftTokenId = await convertToHederaId(nftAddr);
								const serials = prize.nftSerials[j].map(s => Number(s));
								const serialsStr = serials.join(', ');

								try {
									const nftDets = await getTokenDetails(env, nftTokenId);
									console.log(`              → ${nftDets.symbol}: serials [${serialsStr}]`);
								}
								catch {
									console.log(`              → ${nftTokenId}: serials [${serialsStr}]`);
								}
							}
						}
					}

					console.log('\n═══════════════════════════════════════════════════════════\n');
				}

				console.log('📌 Next steps:');
				console.log('   • Use userState.js to view all your pending prizes');
				console.log('   • Use claimPrize.js or claimAllPrizes.js to claim them\n');
			}
			else {
				console.log('😔 No wins this time. Better luck next time!\n');
			}
		}

		// Wait for mirror node sync
		console.log('⏳ Waiting 5 seconds for mirror node to sync...\n');
		await new Promise(resolve => setTimeout(resolve, 5000));

		// Show updated owned serials
		console.log('🔍 Checking remaining NFT tickets...\n');

		const updatedSerials = await getSerialsOwned(env, operatorId.toString(), poolTokenId);

		if (updatedSerials && updatedSerials.length > 0) {
			console.log(`✅ You now own ${updatedSerials.length} NFT ticket(s): ${updatedSerials.join(', ')}\n`);
		}
		else {
			console.log('✅ You have no remaining NFT tickets for this pool.\n');
		}
	}
	catch (error) {
		console.error('\n❌ Error rolling NFT tickets:', error.message);

		// Check for specific revert reasons
		if (error.message.includes('AlreadyWinningTicket')) {
			console.error('\n⚠️  One or more of the NFTs you selected is a PRIZE NFT, not a ticket NFT.');
			console.error('   Prize NFTs cannot be rolled - they are already won prizes.');
			console.error('   Use claimPrize.js to claim your prize NFTs.\n');
		}
		else if (error.status) {
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
rollFromNFT();
