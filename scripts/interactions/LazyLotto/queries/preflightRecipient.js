/**
 * LazyLotto Migration Preflight — recipient readiness (read-only, run before Phase B/C)
 *
 * The OPERATOR account both SIGNS the extraction txs and RECEIVES the prizes (for these
 * global pools, removePrizes/claim send to msg.sender). This checks it can actually do both:
 *   1. isAdmin(operator) == true  — else closePool / removePrizes / adminGrantEntry revert.
 *   2. operator can receive every prize NFT collection — already associated OR unlimited
 *      auto-association — else the HTS transfer-back reverts mid-drain (wasted gas).
 *
 * Prize collections are read from the latest migration snapshot (or a path arg).
 *
 * Usage:
 *   ENVIRONMENT=mainnet ACCOUNT_ID=0.0.697777 PRIVATE_KEY=... LAZY_LOTTO_CONTRACT_ID=0.0.10584509 \
 *     node scripts/interactions/LazyLotto/queries/preflightRecipient.js [snapshot.json]
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { getEnvConfig, getContractId } = require('../../../../utils/clientFactory');
const { loadInterface } = require('../../../../utils/abiLoader');
const { queryContract } = require('../../../../utils/queryHelpers');
const { getBaseURL } = require('../../../../utils/hederaMirrorHelpers');

const { operatorId, env } = getEnvConfig();
const contractId = getContractId('LAZY_LOTTO_CONTRACT_ID');

function latestSnapshot() {
	const dir = 'migration-snapshots';
	if (!fs.existsSync(dir)) {
		return null;
	}
	const files = fs.readdirSync(dir).filter((f) => f.startsWith('pools-snapshot-') && f.endsWith('.json')).sort();
	return files.length ? path.join(dir, files[files.length - 1]) : null;
}

async function isAssociated(tokenId) {
	const url = `${getBaseURL(env)}/api/v1/accounts/${operatorId.toString()}/tokens?token.id=${tokenId}&limit=1`;
	const res = await axios.get(url);
	return (res.data.tokens || []).some((t) => t.token_id === tokenId);
}

async function main() {
	const snapPath = process.argv[2] || latestSnapshot();
	if (!snapPath || !fs.existsSync(snapPath)) {
		console.error('❌ No snapshot found. Run snapshotForMigration.js first, or pass a path.');
		process.exit(1);
	}
	const snap = JSON.parse(fs.readFileSync(snapPath, 'utf8'));
	const collections = Object.keys((snap.reconciliation || {}).nftTotalsByCollection || {})
		.filter((c) => c && c !== 'HBAR');

	console.log('\n╔════════════════════════════════════════════════════════════╗');
	console.log('║   LazyLotto Migration PREFLIGHT — recipient readiness      ║');
	console.log('╚════════════════════════════════════════════════════════════╝\n');
	console.log(`📍 Environment: ${env.toUpperCase()}`);
	console.log(`📄 Contract:    ${contractId.toString()}`);
	console.log(`👤 Operator (signs + receives): ${operatorId.toString()}`);
	console.log(`📦 Snapshot:    ${snapPath}\n`);

	try {
		const lotto = loadInterface('LazyLotto');

		// 1. admin check
		const adminRes = await queryContract(env, contractId, lotto, 'isAdmin', [operatorId.toSolidityAddress()], operatorId);
		const admin = adminRes[0];
		console.log(`1) isAdmin: ${admin ? '✅ YES' : '❌ NO — closePool / removePrizes / adminGrantEntry will revert NotAuthorized'}`);

		// 2. auto-association capacity
		const acct = (await axios.get(`${getBaseURL(env)}/api/v1/accounts/${operatorId.toString()}`)).data;
		const maxAuto = Number(acct.max_automatic_token_associations);
		const unlimited = maxAuto === -1;
		console.log(`2) max_automatic_token_associations: ${maxAuto}${unlimited ? '  (UNLIMITED ✅)' : ''}`);

		// 3. per-collection association
		console.log(`\n3) Prize NFT collections to receive (${collections.length}):`);
		const missing = [];
		for (const c of collections) {
			const assoc = await isAssociated(c);
			if (!assoc && !unlimited) {
				missing.push(c);
			}
			const tag = assoc ? '✅ associated' : (unlimited ? '➕ will auto-associate' : '⚠️  NOT associated');
			console.log(`   ${tag}  ${c}  (${snap.reconciliation.nftTotalsByCollection[c]} serials)`);
		}

		// verdict
		console.log('\n═══ VERDICT ═══');
		const receiveOk = unlimited || missing.length === 0;
		if (admin && receiveOk) {
			console.log(`✅ READY — ${operatorId.toString()} is admin and can receive every prize collection. Clear for Phase B/C.`);
		}
		else {
			if (!admin) {
				console.log(`❌ ${operatorId.toString()} is NOT an admin. Add it as admin before extracting.`);
			}
			if (!receiveOk) {
				console.log(`⚠️  ${missing.length} collection(s) not associated and auto-assoc is limited (${maxAuto} slots).`);
				console.log('   EITHER associate these on the operator, OR ensure it has enough free auto-assoc slots:');
				missing.forEach((m) => console.log(`     ${m}`));
			}
			process.exitCode = 1;
		}
		console.log('');
	}
	catch (error) {
		console.error('\n❌ Preflight failed:', error.message);
		process.exit(1);
	}
}

main();
