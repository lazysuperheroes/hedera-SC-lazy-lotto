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
	const p = resolveRollParams(flags);
	const decimals = p.lazyDecimals;

	const { signature, signerAddress } = await buildRollSignature(p);

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

	// 4. burn % for roller (and detect invalid LSH tokens)
	try {
		const burnRes = await queryContract(env, contractId, ltlIface, 'getBurnForUser', [p.roller], operatorId);
		console.log(`  burn for roller: ${Number(burnRes[0])}% (0% = holds/delegated an LSH NFT)`);
	}
	catch {
		console.log('  burn for roller: query reverted -> an LSH token address is likely not a real NFT.');
		console.log('    If a roll WINS, getBurnForUser is called on-chain and the payout will revert.');
	}

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
		[p.token, p.serial, p.nonce, p.buyer, p.winRateThreshold, p.minWinAmt, p.maxWinAmt, p.jackpotThreshold, signature],
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
