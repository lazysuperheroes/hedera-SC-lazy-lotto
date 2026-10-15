/**
 * LazyTradeLotto - Resolve a user's burn exemption (v2)
 *
 * In v2 the contract no longer looks up LSH holdings: the off-chain signer decides whether a roll
 * is burn-exempt and signs `burnExempt` into the roll. This script is the reference resolver for
 * that decision, mirroring v1's on-chain rule with the stale-delegation hole (audit TL-05) closed:
 *
 *   burnExempt = holds an LSH Gen1 / Gen2 / Gen1 Mutant NFT
 *             || has an LSH serial delegated to them in LazyDelegateRegistry that is STILL VALID
 *                (checkNFTDelegationIsValidBatch: the delegator still owns the serial)
 *
 * Exempt winners pay 0% burn; everyone else pays the contract's burnPercentage.
 *
 * Usage: node queries/getUserBurn.js <contractId> <user>
 *   user: account id (0.0.x) or EVM address
 *
 * Env: LSH_GEN1_TOKEN_ID, LSH_GEN2_TOKEN_ID, LSH_GEN1_MUTANT_TOKEN_ID,
 *      LAZY_DELEGATE_REGISTRY_CONTRACT_ID, ENVIRONMENT, ACCOUNT_ID
 */

require('dotenv').config();
const axios = require('axios');
const {
	AccountId,
	ContractId,
	TokenId,
} = require('@hashgraph/sdk');
const { loadInterface } = require('../../../../utils/abiLoader');
const { queryContract } = require('../../../../utils/queryHelpers');
const { getArgFlag, sleep } = require('../../../../utils/nodeHelpers');
const { getBaseURL } = require('../../../../utils/hederaMirrorHelpers');

const contractName = 'LazyTradeLotto';
const LSH_ENV = ['LSH_GEN1_TOKEN_ID', 'LSH_GEN2_TOKEN_ID', 'LSH_GEN1_MUTANT_TOKEN_ID'];

// checkNFTDelegationIsValidBatch makes one ownerOf (one HTS child record) per serial, and a
// transaction may produce at most 50 following child records; stay well under that.
const VALIDITY_CHUNK = 40;
// getSerialsDelegatedTo has no HTS calls but costs ~2-3k gas per serial
const LIST_GAS = 3_000_000;

/**
 * GET a mirror-node path, retrying transient failures. Throws instead of guessing: the signer must
 * never sign a roller address or burn flag derived from a failed lookup.
 * @param {string} env ENVIRONMENT value
 * @param {string} path e.g. /api/v1/accounts/0.0.123
 * @param {object} [o]
 * @param {boolean} [o.allow404=false] return null on 404 instead of throwing
 */
async function mirrorGetStrict(env, path, { allow404 = false } = {}) {
	const url = `${getBaseURL(env)}${path}`;
	let lastErr;
	for (let attempt = 0; attempt < 4; attempt++) {
		try {
			return (await axios.get(url, { timeout: 10_000 })).data;
		}
		catch (err) {
			const status = err.response?.status;
			if (status === 404 && allow404) return null;
			// 4xx other than rate limiting won't improve with a retry
			if (status && status < 500 && status !== 429) throw new Error(`Mirror ${status} for ${path}`);
			lastErr = err;
			await sleep(500 * 2 ** attempt);
		}
	}
	throw new Error(`Mirror lookup failed for ${path}: ${lastErr?.message}`);
}

/**
 * Resolve the address Hedera uses as msg.sender for an account: its EVM alias (ECDSA accounts
 * with an alias) or else its long-zero address. Signing for any other form makes the roll revert
 * InvalidTeamSignature.
 * @param {string} env ENVIRONMENT value
 * @param {string} user account id (0.0.x) or EVM address
 * @returns {Promise<{accountId: string, rollerAddress: string, longZero: string, delegationAddress: string|null}>}
 */
async function resolveRoller(env, user) {
	const account = await mirrorGetStrict(env, `/api/v1/accounts/${user}`);
	const accountId = account.account;
	const longZero = `0x${AccountId.fromString(accountId).toSolidityAddress()}`.toLowerCase();
	const evm = typeof account.evm_address === 'string' ? account.evm_address.toLowerCase() : '';
	const rollerAddress = /^0x[0-9a-f]{40}$/.test(evm) ? evm : longZero;
	return { accountId, rollerAddress, longZero, delegationAddress: codeDelegationOf(account) };
}

/**
 * HIP-1340 code delegation of a mirror account record, or null. The mirror omits the field (or
 * returns null / "0x") for undelegated accounts, so only a real non-zero address counts.
 * @param {object} account mirror /api/v1/accounts/{id} response
 */
function codeDelegationOf(account) {
	const d = account?.delegation_address;
	if (typeof d !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(d) || /^0x0{40}$/.test(d)) return null;
	return d.toLowerCase();
}

/**
 * Decide the burnExempt flag the signer should sign for `user`.
 *
 * Fails closed: any mirror or contract-call failure throws. The caller then either refuses to
 * sign (ask the user to retry) or signs burnExempt=false; it must never sign true on a guess.
 * @param {object} o
 * @param {string} o.env ENVIRONMENT value
 * @param {string} o.user account id (0.0.x) or EVM address
 * @param {AccountId} o.operatorId account used as `from` for mirror-node view calls
 * @param {string[]} o.lshTokenIds LSH collection token ids (0.0.x)
 * @param {string} o.ldrId LazyDelegateRegistry contract id (0.0.x)
 * @returns {Promise<{burnExempt: boolean, accountId: string, rollerAddress: string, rollerAddresses: string[], direct: object[], delegated: object[]}>}
 */
async function resolveBurnExempt({ env, user, operatorId, lshTokenIds, ldrId }) {
	const { accountId, rollerAddress, longZero } = await resolveRoller(env, user);
	// delegations are keyed by address, and a delegator may have used either form
	const rollerAddresses = [...new Set([rollerAddress, longZero])];

	// 1. direct holdings
	const direct = [];
	for (const tokenId of lshTokenIds) {
		const res = await mirrorGetStrict(env, `/api/v1/accounts/${accountId}/tokens?token.id=${tokenId}`);
		const row = (res.tokens ?? []).find((t) => t.token_id === tokenId);
		direct.push({ tokenId, balance: Number(row?.balance ?? 0) });
	}
	if (direct.some((d) => d.balance > 0)) {
		return { burnExempt: true, accountId, rollerAddress, rollerAddresses, direct, delegated: [] };
	}

	// 2. delegations that are still valid (the delegator still owns the serial). One valid serial
	//    is enough, so stop at the first.
	const ldrIface = loadInterface('LazyDelegateRegistry');
	const ldr = ContractId.fromString(ldrId);
	const delegated = [];
	for (const addr of rollerAddresses) {
		for (const tokenId of lshTokenIds) {
			const tokenAddr = `0x${TokenId.fromString(tokenId).toSolidityAddress()}`;
			// the full list in one call: getSerialsDelegatedToRange panics for any offset > 0
			// (LazyDelegateRegistry writes serials[j] instead of serials[j - offset])
			const res = await queryContract(env, ldr, ldrIface, 'getSerialsDelegatedTo', [addr, tokenAddr], operatorId, { gas: LIST_GAS });
			const list = [...res[0]].map(Number);
			for (let i = 0; i < list.length; i += VALIDITY_CHUNK) {
				const chunk = await checkValidChunk({ env, ldr, ldrIface, operatorId, tokenId, tokenAddr, serials: list.slice(i, i + VALIDITY_CHUNK) });
				delegated.push({ delegate: addr, tokenId, ...chunk });
				if (chunk.valid.some(Boolean)) {
					return { burnExempt: true, accountId, rollerAddress, rollerAddresses, direct, delegated };
				}
			}
		}
	}
	return { burnExempt: false, accountId, rollerAddress, rollerAddresses, direct, delegated };
}

/**
 * checkNFTDelegationIsValidBatch for one chunk. ownerOf reverts for a burned serial, which reverts
 * the whole call (and the registry can't revoke that delegation), so on failure drop serials the
 * mirror reports as deleted and retry once.
 */
async function checkValidChunk({ env, ldr, ldrIface, operatorId, tokenId, tokenAddr, serials }) {
	const call = (list) => queryContract(env, ldr, ldrIface, 'checkNFTDelegationIsValidBatch', [[tokenAddr], [list]], operatorId);
	try {
		return { serials, valid: [...(await call(serials))[0][0]] };
	}
	catch (err) {
		const live = [];
		for (const serial of serials) {
			const nft = await mirrorGetStrict(env, `/api/v1/tokens/${tokenId}/nfts/${serial}`, { allow404: true });
			if (nft && !nft.deleted) live.push(serial);
		}
		if (live.length === serials.length) throw err;
		if (live.length === 0) return { serials: [], valid: [] };
		return { serials: live, valid: [...(await call(live))[0][0]] };
	}
}

async function main() {
	const env = process.env.ENVIRONMENT ?? null;
	const args = process.argv.slice(2);
	if (args.length < 2 || getArgFlag('h')) {
		console.log('Usage: getUserBurn.js <contractId> <user>');
		console.log('       contractId: LazyTradeLotto v2 contract (for its burnPercentage)');
		console.log('       user: account id (0.0.x) or EVM address');
		console.log('\nResolves the burnExempt flag the signer should sign: LSH holder or valid LSH delegate.');
		return;
	}

	let operatorId;
	try {
		operatorId = AccountId.fromString(process.env.ACCOUNT_ID);
	}
	catch {
		console.log('ERROR: Must specify ACCOUNT_ID in the .env file');
		process.exit(1);
	}

	const lshTokenIds = LSH_ENV.map((k) => process.env[k]);
	if (lshTokenIds.some((t) => !t) || !process.env.LAZY_DELEGATE_REGISTRY_CONTRACT_ID) {
		console.log(`ERROR: set ${LSH_ENV.join(', ')} and LAZY_DELEGATE_REGISTRY_CONTRACT_ID in .env`);
		process.exit(1);
	}

	const contractId = ContractId.fromString(args[0]);
	console.log('\n-Using ENVIRONMENT:', env);
	console.log('-Using Contract:', contractId.toString());
	console.log('-Checking User:', args[1]);

	const r = await resolveBurnExempt({
		env,
		user: args[1],
		operatorId,
		lshTokenIds,
		ldrId: process.env.LAZY_DELEGATE_REGISTRY_CONTRACT_ID,
	});
	const contractBurn = Number((await queryContract(env, contractId, loadInterface(contractName), 'burnPercentage', [], operatorId))[0]);

	console.log('\n═══════════════════════════════════════════════════════════');
	console.log('           Burn Exemption (signed burnExempt)');
	console.log('═══════════════════════════════════════════════════════════\n');
	console.log('Account:', r.accountId, `(msg.sender ${r.rollerAddress}; delegations checked for ${r.rollerAddresses.join(' / ')})`);
	console.log('\nDirect LSH holdings:');
	r.direct.forEach((d) => console.log(`  ${d.tokenId}: ${d.balance}`));
	if (r.delegated.length > 0) {
		console.log('\nLSH serials delegated to this account:');
		r.delegated.forEach((d) => console.log(`  ${d.tokenId} -> ${d.delegate}: ${d.serials.map((s, i) => `${s}${d.valid[i] ? '' : ' (stale)'}`).join(', ')}`));
	}
	console.log('\nburnExempt to sign:', r.burnExempt);
	console.log('Burn applied on a win:', r.burnExempt ? '0%' : `${contractBurn}%`);
}

module.exports = { resolveBurnExempt, resolveRoller, codeDelegationOf, mirrorGetStrict };

if (require.main === module) {
	main()
		.then(() => process.exit(0))
		.catch((error) => {
			console.error(error);
			process.exit(1);
		});
}
