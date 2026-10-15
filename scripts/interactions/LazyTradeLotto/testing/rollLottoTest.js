/**
 * LazyTradeLotto - End-to-end roll test (TestNet)
 *
 * Signs a roll with the SIGNING_KEY in .env and submits rollLotto() as the
 * operator account, then reports the outcome by diffing the on-chain stats.
 * This is the in-repo stand-in for the production Lazy Secure Trade scanner.
 *
 * The submitting account (.env ACCOUNT_ID) IS the roller (msg.sender); the
 * signature is bound to it. Use --roller only if you sign for a different
 * caller (then that caller must submit the tx, not this script).
 *
 * Pre-flight checks performed before sending:
 *   - signer recovered from SIGNING_KEY == contract systemWallet
 *   - contract is NOT paused
 *   - this (token, serial, nonce, buyer) has not already been rolled
 *   - burn % the roller will incur (and whether LSH balanceOf reverts)
 *
 * Usage:
 *   node scripts/interactions/LazyTradeLotto/testing/rollLottoTest.js [contractId] \
 *     --token 0.0.789 --serial 42 --nonce 1000 --buyer true \
 *     --winRate 50000000 --minWin 5 --maxWin 20 --jackpotRate 5000000 [--yes]
 *
 * contractId defaults to LAZY_TRADE_LOTTO_CONTRACT_ID from .env.
 * For a guaranteed win on TestNet pass --winRate 100000000.
 * See generateSignature.js for the full flag reference.
 */

require('dotenv').config();
const { ContractId } = require('@hashgraph/sdk');
const { ethers } = require('ethers');
const readlineSync = require('readline-sync');
const { createClient, getEnvConfig } = require('../../../../utils/clientFactory');
const { loadInterface } = require('../../../../utils/abiLoader');
const { queryContract } = require('../../../../utils/queryHelpers');
const { contractExecuteFunction } = require('../../../../utils/solidityHelpers');
const { buildRollSignature, resolveRollParams, parseArgs, parseRollOutcome, isTokenAssociated } = require('./generateSignature');
const { resolveBurnExempt, resolveRoller } = require('../queries/getUserBurn');

const contractName = 'LazyTradeLotto';
const GAS = 1_500_000;

function fmtLazy(raw, decimals) {
	return (Number(raw) / 10 ** decimals).toLocaleString(undefined, { maximumFractionDigits: decimals });
}

async function main() {
	const argv = process.argv.slice(2);
	const { flags, positionals } = parseArgs(argv);

	if (flags.h !== undefined || flags.help !== undefined || !flags.token) {
		console.log('Usage: rollLottoTest.js [contractId] --token <id> --serial <n> --nonce <n> [options]');
		console.log('  contractId defaults to LAZY_TRADE_LOTTO_CONTRACT_ID in .env');
		console.log('  --yes   skip the confirmation prompt');
		console.log('  See generateSignature.js --help for all roll flags.');
		return;
	}

	const { operatorId, operatorKey, env } = getEnvConfig();
	const client = createClient(env, operatorId, operatorKey);

	// contractId: first positional arg (not a flag value), else env
	const contractId = ContractId.fromString(positionals[0] || process.env.LAZY_TRADE_LOTTO_CONTRACT_ID);

	const ltlIface = loadInterface(contractName);
	// sign for the contract we are about to roll on (v2 signatures are bound to it)
	const p = await resolveRollParams({ ...flags, contract: flags.contract || contractId.toString() });
	const decimals = p.lazyDecimals;

	const { signature, signerAddress, messageHash } = await buildRollSignature(p);

	console.log('\n-Using ENVIRONMENT:', env);
	console.log('-Using Operator (roller):', operatorId.toString(), `(${p.roller})`);
	console.log('-Using Contract:', contractId.toString());

	console.log('\n═══════════════════════════════════════════════════════════');
	console.log('             LazyTradeLotto - Roll Test');
	console.log('═══════════════════════════════════════════════════════════\n');
	console.log('Token:             ', p.token);
	console.log('Serial:            ', p.serial.toString());
	console.log('Nonce:             ', p.nonce.toString());
	console.log('Buyer:             ', p.buyer);
	console.log('Win threshold:     ', p.winRateThreshold.toString(), `(${Number(p.winRateThreshold) / 1_000_000}%)`);
	console.log('Prize range:       ', fmtLazy(p.minWinAmt, decimals), '-', fmtLazy(p.maxWinAmt, decimals), '$LAZY');
	console.log('Jackpot threshold: ', p.jackpotThreshold.toString(), `(${Number(p.jackpotThreshold) / 1_000_000}%)`);
	console.log('Burn exempt:       ', p.burnExempt);
	console.log('Deadline:          ', p.deadline.toString(), `(${new Date(Number(p.deadline) * 1000).toISOString()})`);

	// ---- Pre-flight checks ---------------------------------------------------
	let blocking = false;

	// 1. signer == systemWallet
	const systemWalletRes = await queryContract(env, contractId, ltlIface, 'systemWallet', [], operatorId);
	const systemWallet = String(systemWalletRes[0]);
	const signerOk = systemWallet.toLowerCase() === signerAddress.toLowerCase();
	console.log('\nPre-flight:');
	console.log('  systemWallet:', systemWallet, signerOk ? 'OK (matches SIGNING_KEY)' : 'MISMATCH!');
	if (!signerOk) {
		console.log('    -> SIGNING_KEY does not match the contract systemWallet; roll WILL revert (InvalidTeamSignature).');
		blocking = true;
	}

	// 1a. the roller we signed for must be the address Hedera will use as msg.sender for the
	//     operator (its EVM alias if it has one, else long-zero)
	const operatorRoller = await resolveRoller(env, operatorId.toString());
	const rollerOk = operatorRoller.rollerAddress.toLowerCase() === p.roller.toLowerCase();
	console.log('  roller:', p.roller, rollerOk ? 'OK (operator msg.sender)' : `MISMATCH! operator rolls as ${operatorRoller.rollerAddress}`);
	if (!rollerOk) {
		console.log('    -> signature is for a different address than msg.sender; roll WILL revert (InvalidTeamSignature).');
		blocking = true;
	}

	// 1b. our digest == the contract's (catches a wrong --contract / ENVIRONMENT chain id / encoding)
	const digestRes = await queryContract(env, contractId, ltlIface, 'getRollMessageHash',
		[p.roller, p.token, p.serial, p.nonce, p.buyer, p.winRateThreshold, p.minWinAmt, p.maxWinAmt, p.jackpotThreshold, p.burnExempt, p.deadline],
		operatorId);
	const digestOk = String(digestRes[0]).toLowerCase() === messageHash.toLowerCase();
	console.log('  roll digest:', digestOk ? 'OK (matches getRollMessageHash)' : 'MISMATCH!');
	if (!digestOk) {
		console.log('    -> signed for a different contract/chain than the one rolled on; roll WILL revert (InvalidTeamSignature).');
		blocking = true;
	}

	// 1c. maxWin within the contract's cap?
	const capRes = await queryContract(env, contractId, ltlIface, 'maxWinAmtCap', [], operatorId);
	const cap = BigInt(capRes[0]);
	const capOk = p.maxWinAmt <= cap;
	console.log('  max win cap:', fmtLazy(cap, decimals), '$LAZY', capOk ? 'OK' : `-> --maxWin exceeds it; roll WILL revert (BadArguments "Win Cap").`);
	if (!capOk) blocking = true;

	// 2. paused?
	const pausedRes = await queryContract(env, contractId, ltlIface, 'isPaused', [], operatorId);
	const paused = pausedRes[0] === true;
	console.log('  paused:', paused ? 'YES' : 'no', paused ? '-> roll WILL revert (Pausable: paused). Unpause first.' : '');
	if (paused) blocking = true;

	// 3. already rolled?
	const historyHash = ethers.keccak256(
		ethers.solidityPacked(['address', 'uint256', 'uint256', 'bool'], [p.token, p.serial, p.nonce, p.buyer]),
	);
	const historyRes = await queryContract(env, contractId, ltlIface, 'history', [historyHash], operatorId);
	const alreadyRolled = historyRes[0] === true;
	console.log('  already rolled:', alreadyRolled ? 'YES -> will revert (AlreadyRolled). Change --nonce.' : 'no');
	if (alreadyRolled) blocking = true;

	// 4. burn exemption: v2 signs it, so compare --burnExempt with what the production rule would sign
	const lshTokenIds = ['LSH_GEN1_TOKEN_ID', 'LSH_GEN2_TOKEN_ID', 'LSH_GEN1_MUTANT_TOKEN_ID'].map((k) => process.env[k]);
	if (lshTokenIds.every(Boolean) && process.env.LAZY_DELEGATE_REGISTRY_CONTRACT_ID) {
		try {
			const resolved = await resolveBurnExempt({
				env,
				user: operatorId.toString(),
				operatorId,
				lshTokenIds,
				ldrId: process.env.LAZY_DELEGATE_REGISTRY_CONTRACT_ID,
			});
			const agrees = resolved.burnExempt === p.burnExempt;
			console.log(`  burn exemption: signing ${p.burnExempt}; LSH holder/valid delegate rule says ${resolved.burnExempt}`,
				agrees ? 'OK' : '-> differs (allowed for testing, but production must sign the resolved value)');
		}
		catch (e) {
			console.log('  burn exemption: could not resolve LSH holdings/delegations:', e.message);
		}
	}
	else {
		console.log(`  burn exemption: signing ${p.burnExempt} (set LSH_*_TOKEN_ID + LAZY_DELEGATE_REGISTRY_CONTRACT_ID to cross-check)`);
	}

	// 4b. payout window: a win larger than what is left in the 24h window reverts PayoutCapReached.
	//     A jackpot hit pays the whole pool, so count it when the jackpot can be hit.
	const [, windowPaid, windowCap, windowRemaining] = await queryContract(env, contractId, ltlIface, 'getPayoutWindow', [], operatorId);
	const jackpotPool = p.jackpotThreshold > 0n
		? BigInt((await queryContract(env, contractId, ltlIface, 'jackpotPool', [], operatorId))[0])
		: 0n;
	const worstCase = p.maxWinAmt + jackpotPool;
	const windowOk = BigInt(windowRemaining) >= worstCase;
	console.log(`  payout window: ${fmtLazy(windowPaid, decimals)} / ${fmtLazy(windowCap, decimals)} $LAZY paid in the last 24h`,
		windowOk ? 'OK' : `-> a max win${jackpotPool > 0n ? ' plus the jackpot' : ''} (${fmtLazy(worstCase, decimals)}) would exceed it; such a roll WILL revert (PayoutCapReached).`);

	// 5. payout recipient must have $LAZY associated (a win transfers $LAZY to msg.sender)
	const assoc = await isTokenAssociated(env, operatorId.toString(), process.env.LAZY_TOKEN_ID);
	if (assoc === false) {
		console.log(`  $LAZY association: NO -> ${operatorId.toString()} is not associated with $LAZY (${process.env.LAZY_TOKEN_ID}).`);
		console.log('    A winning payout WILL revert (PayoutFailed). Associate $LAZY on this account first.');
		blocking = true;
	}
	else if (assoc === true) {
		console.log('  $LAZY association: OK');
	}
	else {
		console.log('  $LAZY association: could not verify (check LAZY_TOKEN_ID) - skipping');
	}

	if (blocking) {
		console.log('\nOne or more blocking conditions above must be resolved before rolling. Aborting.');
		return;
	}

	if (flags.yes === undefined) {
		const proceed = readlineSync.keyInYNStrict('\nSubmit this roll?');
		if (!proceed) {
			console.log('Cancelled.');
			return;
		}
	}

	// ---- Execute -------------------------------------------------------------
	console.log('\nSubmitting rollLotto...');
	const result = await contractExecuteFunction(
		contractId,
		ltlIface,
		client,
		GAS,
		'rollLotto',
		[p.token, p.serial, p.nonce, p.buyer, p.winRateThreshold, p.minWinAmt, p.maxWinAmt, p.jackpotThreshold, p.burnExempt, p.deadline, signature],
	);

	const status = result[0]?.status?.toString?.() || result[0];
	if (status !== 'SUCCESS') {
		console.log('\nRoll FAILED:', status, result[0]);
		return;
	}

	const txId = result[2]?.transactionId?.toString?.() || 'N/A';
	console.log('Roll submitted. Status:', status, '| Tx:', txId);

	// ---- Outcome from the tx record's events (authoritative, no mirror lag) --
	const outcome = parseRollOutcome(result[2], ltlIface);

	console.log('\n═══════════════════════════════════════════════════════════');
	console.log('                    Roll Outcome');
	console.log('═══════════════════════════════════════════════════════════');
	console.log('  Regular win:', outcome.winAmount > 0n ? `YES (+${fmtLazy(outcome.winAmount, decimals)} $LAZY)` : 'no');
	console.log('  Jackpot win:', outcome.jackpotWon ? `YES (+${fmtLazy(outcome.jackpotAmount, decimals)} $LAZY)` : 'no');
	if (outcome.newJackpotPool !== null) {
		console.log('  New jackpot pool:', fmtLazy(outcome.newJackpotPool, decimals), '$LAZY');
	}
	console.log('═══════════════════════════════════════════════════════════');
	console.log('\nTip: queries/getLottoInfo.js shows cumulative stats (mirror may lag a few seconds).\n');
}

main()
	.then(() => process.exit(0))
	.catch(error => {
		console.error('ERROR:', error.message || error);
		process.exit(1);
	});
