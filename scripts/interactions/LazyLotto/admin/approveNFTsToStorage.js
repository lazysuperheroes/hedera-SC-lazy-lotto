/**
 * LazyLotto Approve NFTs to Storage Script
 *
 * Approves NFT collections for transfer to LazyLottoStorage.
 * Required before adding NFT prize packages (addPrizesBatch.js also handles this
 * automatically, but this script lets you verify/set approvals independently).
 *
 * Usage:
 *   Interactive:  node approveNFTsToStorage.js
 *   With tokens:  node approveNFTsToStorage.js -tokens 0.0.12345,0.0.67890
 *   Check only:   node approveNFTsToStorage.js -check
 */

require('dotenv').config();
const { TokenId, ContractId } = require('@hashgraph/sdk');
const { createClient, getEnvConfig, getContractId } = require('../../../../utils/clientFactory');
const { prompt } = require('../../../../utils/promptHelpers');
const { setNFTAllowanceAll } = require('../../../../utils/hederaHelpers');
const {
	getNFTApprovedForAllAllowances,
	getSerialsOwned,
} = require('../../../../utils/hederaMirrorHelpers');
const { getArgFlag, getArg } = require('../../../../utils/nodeHelpers');

const { operatorId, operatorKey, env } = getEnvConfig();

async function main() {
	const storageId = process.env.LAZY_LOTTO_STORAGE;
	if (!storageId) {
		console.error('❌ Missing LAZY_LOTTO_STORAGE in .env');
		process.exit(1);
	}

	const checkOnly = getArgFlag('check');
	const tokensArg = getArg('tokens');

	console.log('\n╔════════════════════════════════════════════════════════════╗');
	console.log('║       LazyLotto NFT Approval to Storage                   ║');
	console.log('╚════════════════════════════════════════════════════════════╝\n');
	console.log(`📍 Environment: ${env.toUpperCase()}`);
	console.log(`👤 Operator: ${operatorId.toString()}`);
	console.log(`📦 Storage: ${storageId}`);
	if (checkOnly) console.log('🔍 Mode: CHECK ONLY\n');
	else console.log('🔧 Mode: APPROVE\n');

	// Get token IDs
	let tokenIds;
	if (tokensArg) {
		tokenIds = tokensArg.split(',').map(t => t.trim());
	}
	else {
		const input = await prompt('Enter NFT token IDs (comma-separated, e.g. 0.0.12345,0.0.67890): ');
		tokenIds = input.split(',').map(t => t.trim()).filter(t => t.length > 0);
	}

	if (tokenIds.length === 0) {
		console.error('❌ No token IDs provided');
		process.exit(1);
	}

	console.log(`\n📋 Checking ${tokenIds.length} collection(s)...\n`);

	// Check existing approvals
	const existingApprovals = await getNFTApprovedForAllAllowances(env, operatorId);
	const storageString = ContractId.fromString(storageId).toString();
	const approvedTokens = existingApprovals.get(storageString) || [];

	const needsApproval = [];

	for (const tokenId of tokenIds) {
		const isApproved = approvedTokens.includes(tokenId);
		const ownedSerials = await getSerialsOwned(env, operatorId, tokenId);
		const serialCount = ownedSerials ? ownedSerials.length : 0;

		if (isApproved) {
			console.log(`  ✅ ${tokenId} — approved (${serialCount} serials owned)`);
		}
		else {
			console.log(`  ❌ ${tokenId} — NOT approved (${serialCount} serials owned)`);
			if (serialCount > 0) {
				needsApproval.push(tokenId);
			}
			else {
				console.log(`     ⚠️  Skipping — no serials owned`);
			}
		}
	}

	if (needsApproval.length === 0) {
		console.log('\n✅ All collections are approved (or have no serials to approve).');
		process.exit(0);
	}

	if (checkOnly) {
		console.log(`\n⚠️  ${needsApproval.length} collection(s) need approval: ${needsApproval.join(', ')}`);
		console.log('Run without -check to set approvals.');
		process.exit(0);
	}

	// Confirm and approve
	const confirmAnswer = await prompt(`\nApprove ${needsApproval.length} collection(s) to Storage? (yes/no): `);
	if (confirmAnswer.toLowerCase() !== 'yes' && confirmAnswer.toLowerCase() !== 'y') {
		console.log('\n❌ Cancelled');
		process.exit(0);
	}

	const client = createClient(env, operatorId, operatorKey);

	try {
		const tokenIdObjs = needsApproval.map(t => TokenId.fromString(t));

		console.log('\n🔄 Setting approveForAll...');
		const status = await setNFTAllowanceAll(
			client,
			tokenIdObjs,
			operatorId,
			ContractId.fromString(storageId),
			'LazyLotto NFT approval to Storage',
		);

		if (status !== 'SUCCESS') {
			console.error(`❌ Approval failed: ${status}`);
			process.exit(1);
		}

		console.log('✅ All collections approved successfully!\n');
		console.log('Collections approved:');
		for (const tokenId of needsApproval) {
			console.log(`  • ${tokenId}`);
		}
		console.log(`\nSpender: ${storageId} (LazyLottoStorage)\n`);
	}
	catch (error) {
		console.error(`\n❌ Error: ${error.message}`);
		process.exit(1);
	}
	finally {
		client.close();
	}
}

main().catch(error => {
	console.error('❌ Fatal error:', error);
	process.exit(1);
});
