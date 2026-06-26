/**
 * LazyTradeLotto - Simulate a full trade (buyer + seller rolls) on TestNet
 *
 * A real trade can be rolled twice: once by the buyer and once by the seller.
 * This script rolls BOTH sides of one trade (same token/serial/nonce) from the
 * operator account in a single run. That is valid because the contract's replay
 * key is keccak256(token, serial, nonce, buyer) - the buyer flag makes the two
 * rolls distinct history entries, so one account can submit both.
 *
 * (For a true two-party test, run rollLottoTest.js from two different accounts;
 * the signature binds msg.sender, so each party must submit their own roll.)
 *
 * Usage:
 *   node scripts/interactions/LazyTradeLotto/testing/simulateTrade.js [contractId] \
 *     --token 0.0.8011515 --serial 1 --nonce 1 \
 *     --winRate 50000000 --minWin 5 --maxWin 20 --jackpotRate 5000000 [--yes]
 *
 * contractId defaults to LAZY_TRADE_LOTTO_CONTRACT_ID in .env.
 * For guaranteed wins on both sides pass --winRate 100000000.
 * No --buyer flag here (it rolls both); see generateSignature.js for other flags.
 * Re-running needs a fresh --nonce (both sides of a nonce can only be rolled once).
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

async function rollSide(ctx, side) {
	const { env, client, contractId, ltlIface, operatorId, flags, decimals } = ctx;

	// override the buyer flag for this side; all other trade params stay identical
	const p = resolveRollParams({ ...flags, buyer: String(side.buyer) });
	const { signature } = await buildRollSignature(p);

	// already-rolled check for THIS side (does not abort the other side)
	const hash = ethers.keccak256(
		ethers.solidityPacked(['address', 'uint256', 'uint256', 'bool'], [p.token, p.serial, p.nonce, p.buyer]),
	);
	const historyRes = await queryContract(env, contractId, ltlIface, 'history', [hash], operatorId);
	if (historyRes[0] === true) {
		console.log(`\n[${side.label}] already rolled for this trade - skipping (bump --nonce to re-test).`);
		return { side: side.label, skipped: true };
	}

	console.log(`\n[${side.label}] submitting roll...`);
	const result = await contractExecuteFunction(
		contractId, ltlIface, client, GAS, 'rollLotto',
		[p.token, p.serial, p.nonce, p.buyer, p.winRateThreshold, p.minWinAmt, p.maxWinAmt, p.jackpotThreshold, signature],
	);

	const status = result[0]?.status?.toString?.() || result[0];
	if (status !== 'SUCCESS') {
		console.log(`[${side.label}] FAILED:`, status, result[0]);
		return { side: side.label, failed: true, status };
	}

	const txId = result[2]?.transactionId?.toString?.() || 'N/A';
	// outcome read straight from the tx record's events (no mirror lag)
	const o = parseRollOutcome(result[2], ltlIface);

	console.log(`[${side.label}] OK | Tx: ${txId}`);
	console.log(`   regular win: ${o.winAmount > 0n ? `YES (+${fmtLazy(o.winAmount, decimals)} $LAZY)` : 'no'}` +
		` | jackpot: ${o.jackpotWon ? `YES (+${fmtLazy(o.jackpotAmount, decimals)} $LAZY)` : 'no'}`);

	return { side: side.label, txId, winAmount: o.winAmount, jackpotWon: o.jackpotWon, jackpotAmount: o.jackpotAmount, newJackpotPool: o.newJackpotPool };
}

async function main() {
	const argv = process.argv.slice(2);
	const { flags, positionals } = parseArgs(argv);

	if (flags.h !== undefined || flags.help !== undefined || !flags.token) {
		console.log('Usage: simulateTrade.js [contractId] --token <id> --serial <n> --nonce <n> [options]');
		console.log('  Rolls BOTH buyer and seller for one trade. contractId defaults to .env LAZY_TRADE_LOTTO_CONTRACT_ID.');
		console.log('  --yes   skip the confirmation prompt');
		console.log('  See generateSignature.js --help for the full flag reference (no --buyer here).');
		return;
	}

	const { operatorId, operatorKey, env } = getEnvConfig();
	const client = createClient(env, operatorId, operatorKey);

	const contractId = ContractId.fromString(positionals[0] || process.env.LAZY_TRADE_LOTTO_CONTRACT_ID);
	const ltlIface = loadInterface(contractName);

	// Resolve trade params once (buyer side) for display + the shared pre-flight
	const p = resolveRollParams({ ...flags, buyer: 'true' });
	const decimals = p.lazyDecimals;
	const { signerAddress } = await buildRollSignature(p);

	console.log('\n-Using ENVIRONMENT:', env);
	console.log('-Using Operator (rolls both sides):', operatorId.toString(), `(${p.roller})`);
	console.log('-Using Contract:', contractId.toString());

	console.log('\n═══════════════════════════════════════════════════════════');
	console.log('          LazyTradeLotto - Simulate Trade');
	console.log('═══════════════════════════════════════════════════════════');
	console.log('Token:             ', p.token);
	console.log('Serial:            ', p.serial.toString(), '| Nonce:', p.nonce.toString());
	console.log('Win threshold:     ', p.winRateThreshold.toString(), `(${Number(p.winRateThreshold) / 1_000_000}%)`);
	console.log('Prize range:       ', fmtLazy(p.minWinAmt, decimals), '-', fmtLazy(p.maxWinAmt, decimals), '$LAZY');
	console.log('Jackpot threshold: ', p.jackpotThreshold.toString(), `(${Number(p.jackpotThreshold) / 1_000_000}%)`);

	// One-time blocking pre-flight (shared by both sides)
	const systemWalletRes = await queryContract(env, contractId, ltlIface, 'systemWallet', [], operatorId);
	const systemWallet = String(systemWalletRes[0]);
	const signerOk = systemWallet.toLowerCase() === signerAddress.toLowerCase();
	const pausedRes = await queryContract(env, contractId, ltlIface, 'isPaused', [], operatorId);
	const paused = pausedRes[0] === true;
	const assoc = await isTokenAssociated(env, operatorId.toString(), process.env.LAZY_TOKEN_ID);

	console.log('\nPre-flight:');
	console.log('  systemWallet:', systemWallet, signerOk ? 'OK (matches SIGNING_KEY)' : 'MISMATCH -> rolls WILL revert');
	console.log('  paused:', paused ? 'YES -> unpause first; rolls WILL revert' : 'no');
	if (assoc === false) console.log(`  $LAZY association: NO -> ${operatorId.toString()} not associated; winning payouts WILL revert (PayoutFailed)`);
	else if (assoc === true) console.log('  $LAZY association: OK');
	else console.log('  $LAZY association: could not verify (check LAZY_TOKEN_ID) - skipping');

	if (!signerOk || paused || assoc === false) {
		console.log('\nBlocking condition above must be resolved first. Aborting.');
		return;
	}

	if (flags.yes === undefined) {
		const proceed = readlineSync.keyInYNStrict('\nRoll BOTH buyer and seller for this trade?');
		if (!proceed) {
			console.log('Cancelled.');
			return;
		}
	}

	const ctx = { env, client, contractId, ltlIface, operatorId, flags, decimals };
	const results = [];
	results.push(await rollSide(ctx, { label: 'BUYER', buyer: true }));
	results.push(await rollSide(ctx, { label: 'SELLER', buyer: false }));

	// Final summary - per-trade totals from authoritative tx events
	let tradePaid = 0n;
	let latestPool = null;
	console.log('\n═══════════════════════════════════════════════════════════');
	console.log('                  Trade Simulation Summary');
	console.log('═══════════════════════════════════════════════════════════');
	for (const r of results) {
		if (r.skipped) {
			console.log(`  ${r.side}: skipped (already rolled)`);
			continue;
		}
		if (r.failed) {
			console.log(`  ${r.side}: FAILED (${r.status})`);
			continue;
		}
		tradePaid += r.winAmount + (r.jackpotWon ? r.jackpotAmount : 0n);
		if (r.newJackpotPool !== null) latestPool = r.newJackpotPool;
		console.log(`  ${r.side}: regular ${r.winAmount > 0n ? `WIN +${fmtLazy(r.winAmount, decimals)}` : '-'}` +
			` | jackpot ${r.jackpotWon ? `WIN +${fmtLazy(r.jackpotAmount, decimals)}` : '-'} | tx ${r.txId}`);
	}
	console.log('  ----------------------------------------------------------');
	console.log('  Paid out this trade:', fmtLazy(tradePaid, decimals), '$LAZY');
	if (latestPool !== null) console.log('  Jackpot pool now:', fmtLazy(latestPool, decimals), '$LAZY');
	console.log('═══════════════════════════════════════════════════════════');
	console.log('\nTip: queries/getLottoInfo.js shows cumulative stats (mirror may lag a few seconds).\n');
}

main()
	.then(() => process.exit(0))
	.catch(error => {
		console.error('ERROR:', error.message || error);
		process.exit(1);
	});
