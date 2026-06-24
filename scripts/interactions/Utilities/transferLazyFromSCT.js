/**
 * Transfer $LAZY out of the LAZY Smart Contract Treasury (SCT / LAZYTokenCreator)
 *
 * The SCT is the $LAZY token treasury (LAZYTokenCreator.sol). Its owner can
 * move treasury-held $LAZY to any associated account via transferHTS().
 *
 * Usage:
 *   node scripts/interactions/Utilities/transferLazyFromSCT.js <wholeLazy> [receiverId] [--yes]
 *
 *   <wholeLazy>   Amount in whole $LAZY (e.g. 1000000 for 1,000,000 LAZY)
 *   [receiverId]  Optional receiver account (default: operator from .env)
 *   --yes         Skip the confirmation prompt
 *
 * Requirements:
 *   - Operator (.env ACCOUNT_ID) must be the SCT owner (onlyOwner).
 *   - Receiver must be associated with the $LAZY token.
 */

require('dotenv').config();
const { AccountId, TokenId } = require('@hashgraph/sdk');
const { ethers } = require('ethers');
const { createClient, getEnvConfig, getContractId } = require('../../../utils/clientFactory');
const { queryContract } = require('../../../utils/queryHelpers');
const { prompt } = require('../../../utils/promptHelpers');
const { getLazyDecimals } = require('../../../utils/tokenHelpers');
const { executeContractFunction } = require('../../../utils/scriptHelpers');

// Legacy contract is outside the abiLoader search path, so load the artifact directly
const sctArtifact = require('../../../artifacts/contracts/legacy/LAZYTokenCreator.sol/LAZYTokenCreator.json');

const MIRROR = {
	test: 'https://testnet.mirrornode.hedera.com',
	testnet: 'https://testnet.mirrornode.hedera.com',
	main: 'https://mainnet-public.mirrornode.hedera.com',
	mainnet: 'https://mainnet-public.mirrornode.hedera.com',
	preview: 'https://previewnet.mirrornode.hedera.com',
	previewnet: 'https://previewnet.mirrornode.hedera.com',
};

function sleep(ms) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

async function getTokenBalance(env, accountId, tokenId) {
	const base = MIRROR[(env || '').toLowerCase()] || MIRROR.test;
	const url = `${base}/api/v1/accounts/${accountId}/tokens?token.id=${tokenId}`;
	const res = await fetch(url);
	const data = await res.json();
	const tok = (data.tokens || [])[0];
	// null => receiver not associated with the token
	return tok ? BigInt(tok.balance) : null;
}

async function main() {
	const { operatorId, operatorKey, env } = getEnvConfig();
	const sctId = getContractId('LAZY_SCT_CONTRACT_ID');
	const lazyTokenId = TokenId.fromString(process.env.LAZY_TOKEN_ID);

	const rawArgs = process.argv.slice(2);
	const skipConfirm = rawArgs.includes('--yes');
	const positional = rawArgs.filter(a => !a.startsWith('--'));

	if (positional.length < 1) {
		console.log('Usage: transferLazyFromSCT.js <wholeLazy> [receiverId] [--yes]');
		process.exit(1);
	}

	const wholeLazy = parseFloat(positional[0]);
	if (isNaN(wholeLazy) || wholeLazy <= 0) {
		console.error('❌ Amount must be a positive number of whole $LAZY.');
		process.exit(1);
	}

	const receiverId = positional[1] ? AccountId.fromString(positional[1]) : operatorId;

	let client;
	try {
		client = createClient(env, operatorId, operatorKey);
		const iface = new ethers.Interface(sctArtifact.abi);

		const decimals = await getLazyDecimals(env);
		const amountBase = BigInt(Math.round(wholeLazy * 10 ** decimals));

		console.log('\n╔════════════════════════════════════════════════════════════╗');
		console.log('║        Transfer $LAZY from SCT Treasury (Owner)           ║');
		console.log('╚════════════════════════════════════════════════════════════╝\n');
		console.log(`📍 Environment: ${env.toUpperCase()}`);
		console.log(`🏦 SCT Treasury: ${sctId.toString()}`);
		console.log(`👤 Owner/Operator: ${operatorId.toString()}`);
		console.log(`🎯 Receiver: ${receiverId.toString()}`);
		console.log(`💎 Amount: ${wholeLazy.toLocaleString()} LAZY (${amountBase} base units, ${decimals}dp)\n`);

		// 1) Ownership check
		const ownerRes = await queryContract(env, sctId, iface, 'owner', [], operatorId);
		const ownerId = AccountId.fromEvmAddress(0, 0, ownerRes[0]).toString();
		if (ownerId !== operatorId.toString()) {
			console.error(`❌ Operator is not the SCT owner (owner is ${ownerId}). transferHTS is onlyOwner.`);
			process.exit(1);
		}
		console.log('✅ Ownership confirmed.');

		// 2) Treasury balance check
		const sctBal = await getTokenBalance(env, sctId.toString(), lazyTokenId.toString());
		if (sctBal === null) {
			console.error('❌ SCT is not associated with the $LAZY token.');
			process.exit(1);
		}
		console.log(`   SCT balance: ${(Number(sctBal) / 10 ** decimals).toLocaleString()} LAZY`);
		if (sctBal < amountBase) {
			console.error(`❌ Insufficient treasury balance. Need ${amountBase}, have ${sctBal}.`);
			process.exit(1);
		}

		// 3) Receiver association check
		const rxBal = await getTokenBalance(env, receiverId.toString(), lazyTokenId.toString());
		if (rxBal === null) {
			console.error(`❌ Receiver ${receiverId.toString()} is not associated with the $LAZY token.`);
			process.exit(1);
		}
		console.log(`   Receiver balance: ${(Number(rxBal) / 10 ** decimals).toLocaleString()} LAZY\n`);

		// 4) Confirm
		if (!skipConfirm) {
			const answer = await prompt('❓ Execute treasury transfer? (yes/no): ');
			if (answer.toLowerCase() !== 'yes' && answer.toLowerCase() !== 'y') {
				console.log('🛑 Cancelled.');
				return;
			}
		}

		// 5) Execute transferHTS(token, receiver, int64 amount)
		console.log('\n📤 Executing transferHTS...');
		const result = await executeContractFunction({
			contractId: sctId,
			iface,
			client,
			functionName: 'transferHTS',
			params: [lazyTokenId.toSolidityAddress(), receiverId.toSolidityAddress(), amountBase],
			gas: 600000,
			payableAmount: 0,
		});

		if (!result.success) {
			throw new Error(result.error || 'Transaction execution failed');
		}

		const txId = result.receipt?.transactionId?.toString() || result.record?.transactionId?.toString() || 'N/A';
		console.log('✅ Transfer successful!');
		console.log(`📋 Transaction: ${txId}\n`);

		// 6) Verify
		console.log('⏳ Waiting 5s for mirror node to sync...\n');
		await sleep(5000);
		const sctAfter = await getTokenBalance(env, sctId.toString(), lazyTokenId.toString());
		const rxAfter = await getTokenBalance(env, receiverId.toString(), lazyTokenId.toString());
		console.log('═══════════════════════════════════════════════════════════');
		console.log('  POST-TRANSFER BALANCES');
		console.log('═══════════════════════════════════════════════════════════');
		console.log(`  SCT:      ${(Number(sctAfter) / 10 ** decimals).toLocaleString()} LAZY`);
		console.log(`  Receiver: ${(Number(rxAfter) / 10 ** decimals).toLocaleString()} LAZY`);
		console.log('═══════════════════════════════════════════════════════════\n');
	}
	catch (error) {
		console.error('\n❌ Error:', error.message);
		process.exit(1);
	}
	finally {
		if (client) {
			client.close();
		}
	}
}

main()
	.then(() => process.exit(0))
	.catch(error => {
		console.error(error);
		process.exit(1);
	});
