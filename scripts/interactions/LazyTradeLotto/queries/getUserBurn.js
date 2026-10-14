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
const {
	AccountId,
	ContractId,
	TokenId,
} = require('@hashgraph/sdk');
const { loadInterface } = require('../../../../utils/abiLoader');
const { queryContract } = require('../../../../utils/queryHelpers');
const { getArgFlag } = require('../../../../utils/nodeHelpers');
const {
	checkMirrorBalance,
	homebrewPopulateAccountEvmAddress,
	homebrewPopulateAccountNum,
} = require('../../../../utils/hederaMirrorHelpers');

const contractName = 'LazyTradeLotto';
const LSH_ENV = ['LSH_GEN1_TOKEN_ID', 'LSH_GEN2_TOKEN_ID', 'LSH_GEN1_MUTANT_TOKEN_ID'];

/**
 * Decide the burnExempt flag the signer should sign for `user`.
 * @param {object} o
 * @param {string} o.env ENVIRONMENT value
 * @param {string} o.user account id (0.0.x) or EVM address
 * @param {AccountId} o.operatorId account used as `from` for mirror-node view calls
 * @param {string[]} o.lshTokenIds LSH collection token ids (0.0.x)
 * @param {string} o.ldrId LazyDelegateRegistry contract id (0.0.x)
 * @returns {Promise<{burnExempt: boolean, accountId: string, rollerAddresses: string[], direct: object[], delegated: object[]}>}
 */
async function resolveBurnExempt({ env, user, operatorId, lshTokenIds, ldrId }) {
	// account id for balances; EVM address(es) for the registry (delegations are keyed by address)
	let accountId;
	if (user.startsWith('0.0.')) {
		accountId = user;
	}
	else {
		accountId = (await homebrewPopulateAccountNum(env, user))?.toString() ?? user;
	}
	const longZero = `0x${AccountId.fromString(accountId).toSolidityAddress()}`.toLowerCase();
	const alias = String(await homebrewPopulateAccountEvmAddress(env, accountId)).toLowerCase();
	const rollerAddresses = [...new Set([alias.startsWith('0x') ? alias : `0x${alias}`, longZero])];

	// 1. direct holdings
	const direct = [];
	for (const tokenId of lshTokenIds) {
		const balance = await checkMirrorBalance(env, accountId, tokenId);
		direct.push({ tokenId, balance: Number(balance ?? 0) });
	}
	if (direct.some((d) => d.balance > 0)) {
		return { burnExempt: true, accountId, rollerAddresses, direct, delegated: [] };
	}

	// 2. delegations that are still valid (the delegator still owns the serial)
	const ldrIface = loadInterface('LazyDelegateRegistry');
	const ldr = ContractId.fromString(ldrId);
	const delegated = [];
	for (const addr of rollerAddresses) {
		const tokens = [];
		const serials = [];
		for (const tokenId of lshTokenIds) {
			const tokenAddr = `0x${TokenId.fromString(tokenId).toSolidityAddress()}`;
			const res = await queryContract(env, ldr, ldrIface, 'getSerialsDelegatedTo', [addr, tokenAddr], operatorId);
			const list = [...res[0]];
			if (list.length > 0) {
				tokens.push(tokenAddr);
				serials.push(list);
			}
		}
		if (tokens.length === 0) continue;
		const validRes = await queryContract(env, ldr, ldrIface, 'checkNFTDelegationIsValidBatch', [tokens, serials], operatorId);
		tokens.forEach((tokenAddr, i) => {
			delegated.push({
				delegate: addr,
				tokenId: TokenId.fromSolidityAddress(tokenAddr).toString(),
				serials: serials[i].map(Number),
				valid: [...validRes[0][i]],
			});
		});
	}
	const burnExempt = delegated.some((d) => d.valid.some(Boolean));
	return { burnExempt, accountId, rollerAddresses, direct, delegated };
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
	console.log('Account:', r.accountId, `(${r.rollerAddresses.join(' / ')})`);
	console.log('\nDirect LSH holdings:');
	r.direct.forEach((d) => console.log(`  ${d.tokenId}: ${d.balance}`));
	if (r.delegated.length > 0) {
		console.log('\nLSH serials delegated to this account:');
		r.delegated.forEach((d) => console.log(`  ${d.tokenId} -> ${d.delegate}: ${d.serials.map((s, i) => `${s}${d.valid[i] ? '' : ' (stale)'}`).join(', ')}`));
	}
	console.log('\nburnExempt to sign:', r.burnExempt);
	console.log('Burn applied on a win:', r.burnExempt ? '0%' : `${contractBurn}%`);
}

module.exports = { resolveBurnExempt };

if (require.main === module) {
	main()
		.then(() => process.exit(0))
		.catch((error) => {
			console.error(error);
			process.exit(1);
		});
}
