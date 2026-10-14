# LazyTradeLotto v2 — Signer & Frontend Migration Guide

What the off-chain signer (lazy-trade `services/lottoSigning.ts`) and the roll UI (`services/lazyTradeLotto.ts`) must change to work with **LazyTradeLotto v2**. v2 is a fresh, non-upgradeable deployment; v1 signatures do not work on it.

## What changed

| Area | v1 | v2 | Why |
|---|---|---|---|
| `rollLotto` arguments | 9 (… `jackpotThreshold`, `teamSignature`) | 11: new `bool burnExempt` and `uint256 deadline` **before** `teamSignature` | See the two rows below |
| Burn exemption | contract read 3 LSH balances + 3 delegate-registry lists on every win | the **signer** decides and signs `burnExempt`; the contract applies `burnPercentage` or 0% | A broken registry/collection bricked all payouts (TL-04); stale delegations kept 0% burn forever (TL-05) |
| Signed message | roller + ticket fields | **contract address + chain id** + roller + ticket fields + **burnExempt** + **deadline** | Replay across deployments/networks (TL-02); signatures used to be valid forever |
| Win cap | none | `maxWinAmt` must be ≤ `maxWinAmtCap()` (owner-settable) | Bounds a leaked/buggy signer per roll (TL-03) |
| Daily cap | none | total payouts per 24h window ≤ `payoutWindowCap()`; wins over it revert `PayoutCapReached` | Bounds total loss from a leaked signer across many rolls (TL-03) |
| Caller | anything the signer signed for | must be an EOA calling directly (`tx.origin == msg.sender`), plus an owner switch, `setRequireCodelessCaller`, to also require no code once HIP-1340 is validated | On-chain backstop for the signer's EOA-only rule (TL-01), ready for EIP-7702 without a redeploy |
| Views | `getBurnForUser`, `LSH_GEN1/2/MUTANT`, `lazyDelegateRegistry` | removed; new `getRollMessageHash(...)`, `getPayoutWindow()`, `maxWinAmtCap`, `payoutWindowCap`, `requireCodelessCaller` | — |
| `JackpotUpdate` from `boostJackpot` | emitted the boost delta | emits the new pool total (and clamps to `maxJackpotPool`) | Event now always means "current pool" (TL-06) |

Unchanged: the `LottoRoll` / `JackpotWin` events, `history` replay guard (`keccak256(token, serial, nonce, buyer)`), win-rate scales, `burnPercentage`, payouts via LazyGasStation, EIP-191 `personal_sign` signing.

## 1. The new signed message

The contract verifies `ECDSA.recover(toEthSignedMessageHash(digest), teamSignature) == systemWallet`, where:

```solidity
digest = keccak256(abi.encodePacked(
    address(this),      // the LazyTradeLotto v2 contract
    block.chainid,      // 295 mainnet, 296 testnet, 297 previewnet, 298 local
    msg.sender,         // the roller
    token, serial, nonce, buyer,
    winRateThreshold, minWinAmt, maxWinAmt, jackpotThreshold,
    burnExempt,         // bool: 0% burn for this roller (see §2)
    deadline            // unix seconds; roll reverts SignatureExpired after it
));
```

Signer change (`generateSignedTicketHash`):

```ts
const HEDERA_CHAIN_ID = { mainnet: 295, testnet: 296, previewnet: 297 } as const;

export async function generateSignedTicketHash(
	ticket: LottoTicket,
	roller: string,
	lottoContractId: string, // runtimeAddresses[currentNetwork].LAZY_TRADE_LOTTO
	burnExempt: boolean,     // §2
	deadline: number,        // unix SECONDS, §3
): Promise<string> {
	if (roller && roller.match(/^\d+\.\d+\.\d+$/)) {
		roller = await homebrewPopulateAccountEvmAddress(roller);
	}
	const tokenId = TokenId.fromString(ticket.tokenId).toSolidityAddress();
	const contract = ContractId.fromString(lottoContractId).toSolidityAddress();

	const messageHash = ethers.solidityPackedKeccak256(
		['address', 'uint256', 'address', 'address', 'uint256', 'uint256', 'bool', 'uint256', 'uint256', 'uint256', 'uint256', 'bool', 'uint256'],
		[
			`0x${contract}`,
			HEDERA_CHAIN_ID[currentNetwork],
			roller,
			tokenId,
			ticket.serial,
			ticket.nonce,
			ticket.side === 'buy',
			ticket.winRatePRNG,
			ticket.minWinAmount,
			ticket.maxWinAmount,
			ticket.jackpotRatePRNG,
			burnExempt,
			deadline,
		],
	);
	return signer.signMessage(ethers.getBytes(messageHash));
}
```

**Which contract address?** `address(this)` is the contract's EVM address. LazyTradeLotto is deployed with the Hedera SDK (`ContractCreateFlow`), so that is the long-zero form, `ContractId.toSolidityAddress()`, the same value lazy-trade already uses as the `to` of its view calls. A contract created through an EVM transaction would instead have a different `evm_address` (see `GET /api/v1/contracts/{id}` on the mirror node). The parity check in §5 catches either mistake.

**Nothing about the address needs to be known before deployment.** The contract reads `address(this)` and `block.chainid` when it verifies each roll, and the signer signs per roll after deployment. The signer only needs the v2 contract ID in config.

## 2. Deciding `burnExempt`

`burnExempt` is true when the roller holds an LSH NFT, or has an LSH NFT delegated to them that is **still valid**:

1. **Direct holdings:** a mirror-node balance > 0 for any of LSH Gen1 `0.0.768753`, Gen2 `0.0.848553` or Gen1 Mutant `0.0.1693200` (`GET /api/v1/accounts/{id}/tokens?token.id=…`).
2. **Valid delegations:** in LazyDelegateRegistry (`0.0.7221486` on mainnet), call `getSerialsDelegatedTo(rollerEvmAddress, lshTokenAddress)` for each collection, then `checkNFTDelegationIsValidBatch(tokens, serials)`. Any `true` means exempt. The validity check is what closes the v1 hole: a delegation whose delegator no longer owns the serial does not count.
   - Check the roller's alias EVM address **and** its long-zero address: a delegation can have been recorded against either.
   - This is how staked LSH NFTs count: the NFT staking contract (`0.0.7221488`) delegates staked serials back to their owners.

`scripts/interactions/LazyTradeLotto/queries/getUserBurn.js` is the reference implementation (`resolveBurnExempt`), and was checked against mainnet accounts covering a direct holder, a non-holder, and a staker whose only LSH is a valid delegation.

The contract cannot check this flag, so the signer is trusted with it, as it already is with the odds and amounts. A wrongly exempt roll only skips the burn on that winner's own payout, which `maxWinAmtCap` and the daily cap already bound.

## 3. Choosing the deadline

Use the auth token's expiry: the roll mutation already issues a 5-minute token (`TOKEN_EXPIRY`). In `lotto.roll`:

```ts
const { token, expiresAt } = generateAuthToken(accountId, ticketId); // expiresAt is ms
const deadline = Math.floor(expiresAt / 1000);                       // contract wants seconds
const burnExempt = await resolveBurnExempt(accountId);               // §2
const signedHash = await generateSignedTicketHash(ticketFromDB, accountId, runtimeAddresses[currentNetwork].LAZY_TRADE_LOTTO, burnExempt, deadline);
return { success: true as const, signedHash, burnExempt, deadline, authToken: token, expiresAt, isRetry: !!ticket.inprogress };
```

- An expired, never-rolled ticket is **not lost**: the stale-ticket retry path simply re-signs it with a fresh deadline (and a freshly resolved `burnExempt`). Replay protection is the on-chain `history`, not the deadline.
- Every re-sign is a fresh chance to re-check eligibility (EOA, delegation — see §6).
- Keep the deadline short. It is what limits how long a signed ticket can sit unused.

## 4. Client change (`rollLotto` in `services/lazyTradeLotto.ts`)

Take `burnExempt` and `deadline` from the roll response and pass them **after `jackpotRatePRNG`, before the signature**:

```ts
const { signedHash, burnExempt, deadline, authToken, expiresAt } = rollData;
if (!signedHash || typeof burnExempt !== 'boolean' || !deadline || !authToken || !expiresAt) {
	throw new Error('Missing required data from API response');
}

const txId = await walletInterface.executeContractFunctionEthers(
	ContractId.fromString(contractId),
	'rollLotto',
	[
		TokenId.fromString(ticket.tokenId).toSolidityAddress(),
		ticket.serial,
		ticket.nonce,
		ticket.side === 'buy',
		ticket.winRatePRNG,
		ticket.minWinAmount,
		ticket.maxWinAmount,
		ticket.jackpotRatePRNG,
		burnExempt,   // NEW
		deadline,     // NEW
		signedHash,
	],
	/* gas etc. unchanged */
);
```

Also:
- Replace `lib/abi/LazyTradeLotto.json` with `abi/LazyTradeLotto.json` from this repo (the `rollLotto` selector changed).
- Point `NEXT_PUBLIC_LAZY_TRADE_LOTTO_CONTRACT_ID` (and the defaults in `config/addresses.ts`) at the v2 contract.
- `verifyRollTxOnChain` needs no change: it checks payer, success, `CONTRACTCALL` and target contract, not the selector.
- The UI can show the user's burn rate from `burnExempt` (0%) or `burnPercentage()`; `getBurnForUser` no longer exists.

### Errors the UI should map

| Revert | Meaning | User-facing handling |
|---|---|---|
| `SignatureExpired()` | The wallet approval took longer than the deadline | "That took too long. Roll again" (request a fresh signature) |
| `InvalidTeamSignature()` | Signer/contract/network mismatch, or a tampered argument (incl. `burnExempt`) | Config bug: log loudly; see the parity check |
| `PayoutCapReached()` | This win would exceed the 24h payout cap | "Daily prize limit reached. Your ticket is safe; roll again later." **Alert ops**: it should only trip under abuse |
| `BadArguments("Win Cap")` | Ticket `maxWinAmount` > `maxWinAmtCap` | Signer should never issue this (see §5) |
| `OnlyEOA()` | Called from a contract / smart-wallet path, or from a delegated account once the codeless requirement is on | "Roll directly from your wallet" |
| `AlreadyRolled()` | This side of this trade was already rolled | Mark ticket complete |

A `PayoutCapReached` roll reverts entirely, so the ticket stays unrolled and can be rolled again once the window resets.

## 5. Signer self-checks (extend `verifyLottoSignerMatchesSystemWallet`)

Alongside the existing `systemWallet()` check, once per instance:

1. **Digest parity.** Build a dummy ticket, compute the digest locally, and compare it with `getRollMessageHash(roller, token, serial, nonce, buyer, winRate, minWin, maxWin, jackpot, burnExempt, deadline)` read through the mirror node `contracts/call`. A mismatch means a wrong contract ID, wrong chain ID, or wrong encoding, and every roll would revert. Fail loudly, as the `systemWallet` check does.
2. **Win cap.** Read `maxWinAmtCap()` and refuse to sign any ticket whose `maxWinAmount` exceeds it, rather than letting the roll revert.
3. **Payout window (monitoring).** `getPayoutWindow()` returns `(start, paid, cap, remaining)`. Alert when `remaining` drops below, say, a day's normal payouts: the cap is the circuit breaker for a leaked key, so hitting it is an incident.

## 6. Forward-compatibility: HIP-1340 (EIP-7702)

Hedera has shipped EOA code delegation switched off (v0.77). When it is enabled, an account could delegate after it was signed for, and a delegated EOA still passes `tx.origin == msg.sender`.

- **Contract:** v2 already has the fix behind an owner switch. Once delegation is validated on testnet, `scripts/interactions/LazyTradeLotto/admin/setRequireCodelessCaller.js 0.0.<v2> on` makes rolls also require a caller with no code. No redeploy needed. (Checked on a local EVM: an EOA carrying an EIP-7702 delegation indicator is rejected when the switch is on and allowed when off; plain EOAs pass either way.)
- **Signer, now:** refuse to sign if the roller's mirror-node account has a non-null `delegation_address` (`GET /api/v1/accounts/{id}`). The field already exists and is null for every account today.

## 7. Test vector

Use this in a unit test for `generateSignedTicketHash`. It was derived from the encoding the contract's `getRollMessageHash` was checked against (testnet chain id, throwaway key):

| Field | Value |
|---|---|
| contract | `0x00000000000000000000000000000000004c4b40` (0.0.5000000) |
| chainId | `296` |
| roller | `0x0000000000000000000000000000000000002f86` (0.0.12166) |
| token | `0x00000000000000000000000000000000000c3500` (0.0.800000) |
| serial / nonce / buyer | `42` / `1234567` / `true` |
| winRateThreshold / minWinAmt / maxWinAmt / jackpotThreshold | `25000000` / `50` / `200` / `500000` |
| burnExempt | `true` |
| deadline | `1800000000` |
| **messageHash** | `0x8a0d55c09315b54bc8347b540bfb6aa83763816af8a5b3834df1ef6b552654ab` |
| signer key | `0x1111111111111111111111111111111111111111111111111111111111111111` |
| signer address | `0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A` |
| **signature** | `0xef7c4492d38ebe4b57ec458c92c817155bd91a8ce304aa17c239b59398e75bf45d33b8bc87973954c22d9fdfee675367a887bc3f25ad91afb7a5c8c4825b1ff81c` |

## 8. Rollout order

The full cross-repo task list is in [LazyTradeLotto-V2_SHIP_CHECKLIST.md](./LazyTradeLotto-V2_SHIP_CHECKLIST.md).

1. **Deploy v2** with `scripts/deployments/deployLazyTradeLotto.js`. It starts paused. Set `LOTTO_MAX_WIN_CAP` (at or just above the largest `maxWinAmount` the signer issues) and `LOTTO_PAYOUT_WINDOW_CAP` (well above normal daily payouts), both in whole $LAZY. Use a **new signing key**, not the testnet one. The constructor no longer takes the LSH collections or the delegate registry.
2. **Authorize it on LazyGasStation** (`scripts/interactions/LazyGasStation/addContractUser.js 0.0.<v2>`).
3. **Check it**: `scripts/deployments/verifySigningKey.js` (systemWallet), `scripts/interactions/LazyTradeLotto/queries/getLottoInfo.js` (caps, payout window, jackpot, connections).
4. **Ship lazy-trade**: burn-exemption resolver (§2), signer change (§1, §3), client change (§4), ABI, contract ID, self-checks (§5).
5. **Testnet first**: `scripts/interactions/LazyTradeLotto/testing/rollLottoTest.js` signs in the v2 format (`--burnExempt`) and pre-flights digest parity, the win cap, the payout window and the resolved burn exemption before rolling.
6. **Unpause v2.** v1 (`0.0.9109659`) stays paused and has been removed from LazyGasStation contract users.
