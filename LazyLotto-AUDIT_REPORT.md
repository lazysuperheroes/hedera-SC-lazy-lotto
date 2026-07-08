# LazyLotto Suite — Final Security Audit Report

## 0. Remediation status (added 2026-07-08)

> This audit was conducted 2026-07-04 against the originally-deployed LazyLotto suite. A remediated **v2** has since been deployed to Hedera mainnet (2026-07-08) and all pools, prizes, and outstanding tickets were migrated to it. Every value-bearing pool on the original contract was drained to zero and the contract retired, so nothing on the original is exploitable for value.
>
> **v2 contracts:** LazyLotto `0.0.10628505` · LazyLottoStorage `0.0.10628497` · LazyLottoPoolManager `0.0.10628512` (PRNG now immutable).
>
> **Fixed in v2:** Finding 1 (`prng` made `immutable`, `setPrng` removed) · Finding 2 (EOA-only `tx.origin == msg.sender` guard on `_roll`, blocking the revert-on-loss re-roll) · Finding 3 (PoolManager reserves the *full* proceeds, so the platform cut is anti-rug-reserved on accrual) · Finding 4 (`adminGrantEntry` / `adminBuyAndRedeemEntry` restricted to global pools) · Finding 5 (`transferPoolOwnership` owner-only; admin-seize branch removed) · Finding 8 (single `TokenTransferList` per collection) · Finding 7's claim cost (single claim now reads from storage, O(1)).
>
> **Accepted / deferred (documented risk):** Finding 6 (batch over-buy is by-design — the caller chooses how many entries to buy) · Finding 7's `transferPendingPrizes` griefing gate · Finding 9 ($LAZY custodied in the shared LazyGasStation — known, accepted) · Finding 10 (`calculateBoost`, admin-fixable via `removeNFTBonus`). The original findings are preserved unedited below.

## 1. Executive Summary

**Scope.** This report covers the three in-scope contracts of the LazyLotto multi-pool lottery suite:

- **`LazyLotto.sol`** — orchestrator: pools, entries, rolling, prize claims, admin/role control, discretionary treasury withdrawals.
- **`LazyLottoStorage.sol`** — treasury / HTS operations (token custody, `cryptoTransfer`, NFT batch moves).
- **`LazyLottoPoolManager.sol`** — community-pool creation, ownership, proceeds/fee accounting, bonus configuration.

`LazyGasStation`, `PrngSystemContract` (0x169), and the HTS precompile (0x167) are treated as **trusted context** (not audited here), except where the audited contracts' security guarantees depend on their behavior — most importantly, the anti-rug invariant's reliance on where $LAZY is actually custodied.

**Method.** Multi-agent adversarial review: vulnerability-class finders proposed issues; each surviving issue was independently re-judged by three verification lenses (reachability, mitigation strength, impact). Only findings that at least one lens confirmed appear below. **Confirmed** = all three lenses ruled the issue real; **Contested** = the lenses split. Line references were spot-checked against source while writing this report.

**Risk posture — honest verdict.** The suite's cryptographic escrow accounting (`ftTokensForPrizes` / `pendingWithdrawals` / `platformBalance`) is well-intentioned and the *literal* solvency check on the two direct-withdraw functions is arithmetically sound in isolation. However, the suite carries **eight confirmed issues**, including five High-severity issues, and **two of them are exploitable by an anonymous, unprivileged user**.

> **⚠️ Anonymous-user exposure (no privileges required):**
> - **Free re-rolls via revert-on-loss (High):** Because a roll's win/loss is drawn *and returned* inside the same transaction, any user can wrap a roll in a contract that reverts on a loss. The reverted transaction restores the consumed entry (and, for `buyAndRollEntry`, refunds the fee), so the caller retries with fresh entropy until they win — paying only gas. This converts the configured win rate into an effective 100% and lets an anonymous attacker **systematically drain every pool's prize inventory** through the *legitimate* claim path.
> - **Silent forfeiture of winning tickets (Medium):** In batch rolls, entries are debited up-front but a win pays out only while prizes remain; once a pool's prize array empties mid-batch, further winning tickets are consumed with **no prize and no refund** — direct user fund loss in ordinary operation.
> - **Griefing DoS on the claim path (Medium):** `transferPendingPrizes` lets anyone push unbounded entries onto a victim's `pending[]` array, and `_claimPrize` copies that entire array to memory on every claim (O(n), O(n²) for `claimAllPrizes`), so the intended claim functions can be gassed out.

> **🚨 Anti-rug invariant — VERDICT: DOES NOT HOLD as a system guarantee.**
> The documented promises that admins "cannot steal prizes" and "cannot extract community pool prizes to themselves" are **false under a malicious or compromised admin key.** The on-chain `_getMinStorageBalance` check guards only two functions (`transferFungible`, `transferHbarFromStorage`) and is defeated four different ways:
> 1. **Swappable PRNG (`setPrng`)** lets one admin rig every roll and route any prize to themselves through the *normal* claim flow — which decrements obligations in lockstep, so the invariant never trips.
> 2. **Admin free entries** (`adminGrantEntry` / `adminBuyAndRedeemEntry`) into *community* pools let an admin win owner-funded prizes at zero cost.
> 3. **`transferPoolOwnership`** lets an admin seize any community pool and drain its owner's accrued proceeds (and, if idle, its prizes).
> 4. **Platform-fee accounting gap** under-reserves the invariant itself, letting an admin legitimately drop storage below `ftTokensForPrizes` and double-pay the platform cut out of prize-obligated funds.
> Additionally (contested), for **$LAZY — the primary entry/prize token — the invariant is vacuous**, because that collateral lives in the shared `LazyGasStation`, not in the Storage balance the check measures.
>
> None of the High-severity admin vectors are anonymously reachable — every one requires a valid admin key — but each is a clean rug path for a single compromised or malicious admin, and the system's on-chain multisig is **not enforced by the contracts** (the CLAUDE.md multisig is off-chain script tooling). `_requireAdmin()` is a bare 1-of-N mapping check.

---

## 2. Findings Overview

| # | Severity | Contract | Anon-reachable | Precondition / Role | Status |
|---|----------|----------|:---:|---------------------|--------|
| 1 | **High** (finders: Critical) | LazyLotto | No | Any single admin key (or compromise) | Confirmed |
| 2 | **High** (finders: Critical) | LazyLotto | **Yes** | Any unprivileged user (contract wrapper) | Confirmed |
| 3 | **High** | LazyLotto + PoolManager | No | Any single admin key | Confirmed |
| 4 | **High** | LazyLotto | No | Any single admin key | Confirmed |
| 5 | **High** | LazyLottoPoolManager | No | Any single admin key | Confirmed |
| 6 | **Medium** | LazyLotto | **Yes** | Any user; occurs in ordinary operation | Confirmed |
| 7 | **Medium** | LazyLotto | **Yes** | Any user (griefer) or heavy legit winner | Confirmed |
| 8 | **Low** (finders: Medium) | LazyLottoStorage | Partial | Pool creator/prize manager adding a prize | Confirmed |
| 9 | **Low / Informational** | LazyLotto (+ LGS, trusted) | No | LGS admin compromise or LGS depletion | **Contested** |
| 10 | **Low / Informational** | LazyLottoPoolManager | No | Admin misconfiguration of bonus tokens | **Contested** |

---

## 3. Detailed Findings

### Finding 1 — Swappable PRNG (`setPrng`) lets a single admin rig every roll and drain all prizes *(defeats the anti-rug invariant + rigs the odds)*

- **Final severity: High.** Finders proposed Critical; verifiers converged on High because exploitation requires the admin role. Given special-prominence criteria (rig-the-odds + anti-rug defeat), this is the flagship privileged risk. One additional finder instance of this same root cause landed *contested* (one lens rated it Informational on the grounds that it is "trusted-role only"); the overwhelming majority of independent verdicts confirmed it real at High. Merged here as one issue.
- **Location:** `LazyLotto.sol:329-335` (`setPrng`); consumed in `_roll` at `1517` (win array) and `1534` (prize-selection array); win check `1552`; prize index `1557`. Amplified by free-entry paths `720-728` / `734-745`.
- **What & why.** `prng` is a mutable state variable. `setPrng` is gated only by `_requireAdmin()` (a single-key `_isAddressAdmin[msg.sender]` check, L262-266). It has **no immutability lock, no timelock, no event, and no constraint that the target be the 0x169 precompile** — only a non-zero check. Notably, the sibling `setPoolManager` (L313) *does* carry a one-time `PoolManagerAlreadySet` guard; `setPrng` does not, despite the NatSpec "for testing purposes" comment on a function that ships live. `_roll` blindly trusts the returned arrays for **both** win determination (`rolls[i] < winRateWithBoost`) and prize selection (`prizeRolls[i] % totalPrizesAvailable`), with no range/sanity validation.
- **Exploit / impact path.** A malicious or compromised admin deploys `EvilPRNG` returning `rolls=[0]` (always wins) and `prizeRolls` chosen so the modulo indexes the single richest package. Calls `setPrng(EvilPRNG)`, grants itself free entries via `adminGrantEntry` (zero capital — see Finding 4), then `rollBatch` wins deterministically and cherry-picks the top NFT/FT prizes into `pending[admin]`. `claimAllPrizes()` moves them out of Storage through `_claimPrize`, which decrements `ftTokensForPrizes` in lockstep — so `_getMinStorageBalance` is satisfied at every step and the solvency check **never fires.** The admin can point `prng` back to 0x169 afterward to hide the change. This drains prizes from **every** pool, including community pools funded by third-party owners, and equally allows forcing all rolls to *lose* (defrauding paying players).
- **Preconditions.** One admin key. On-chain multisig is not enforced; `_requireAdmin` is 1-of-N.
- **Fix.** Make `prng` `immutable` (constructor-only), mirroring how `storageContract` is fixed. If a runtime swap is genuinely required, restrict the target to the canonical 0x169 precompile, gate behind an on-chain timelock + threshold, and emit a loud event on change. Longer term, adopt commit-reveal randomness a single admin cannot substitute.

---

### Finding 2 — Same-transaction roll outcome enables revert-on-loss free re-rolls *(anonymous prize drain)*

- **Final severity: High.** Two finders proposed Critical and one Critical verdict stands; the majority of verifier verdicts settled on High. Merged from six independent finder instances (all the same root cause). **This is the most serious anonymously-exploitable issue.**
- **Location:** `_roll` `LazyLotto.sol:1482-1575` (PRNG drawn in-tx at 1517/1534; win at 1552; entries debited at 1504-1505; prize pushed to `pending` at 1570; returns `wins`). Reachable via `buyAndRollEntry` (682-695), `rollAll` (761-774), `rollBatch` (779-801), `rollWithNFT` (806-823).
- **What & why.** Hedera resolves the 0x169 PRNG **in-transaction**, and every roll entry point *returns the outcome* (`wins`, `offset`) to the caller in the same transaction that consumes the entry (and, for `buyAndRollEntry`, pays the fee). No entry point restricts callers to EOAs (no `tx.origin`/`extcodesize`/`isContract` guard exists). Because Hedera rolls back all state on revert (charging only non-refundable gas), a caller contract can read `wins` and `revert()` on a loss: the entry-decrement at L1504-1505 is unwound (and the fee draw is undone for the atomic buy-and-roll path), leaving the paid entry intact — or never charged — for a fresh retry. Each retry is a new transaction with a fresh n-3 running-hash seed. This is **not** Ethereum mempool front-running (correctly out of scope on Hedera); it is same-transaction outcome-conditional reverting, which the in-transaction randomness design permits.
- **Exploit / impact path.** Attacker deploys `Reroller` with `function go(pid,n){ (uint w,)=LOTTO.buyAndRollEntry(pid,n); require(w>0); }`. Every losing call reverts (fee refunded / entry restored, only gas spent); the first winning call commits, staging the prize into `pending[attacker]`, which is then claimed. Looped against any pool whose prize value exceeds per-attempt gas cost, this extracts prizes for ~1 entry-fee-equivalent instead of the intended `1/winRate`, **draining the entire fungible/NFT/HBAR prize inventory of every pool**. The theft flows through the legitimate `_claimPrize` path, so no accounting invariant is even violated.
- **Preconditions.** None beyond deploying a helper contract and holding a single entry (or `$LAZY` approval for buy-and-roll). Fully anonymous.
- **Fix.** Break atomicity between entropy consumption and the observable/refundable outcome. Adopt a two-phase commit-reveal: phase 1 irreversibly consumes/locks the entry and records a commitment (a future consensus reference); phase 2 settles from entropy fixed *before* phase 2 began and cannot be reverted by the entry payer. Removing the `wins` return value is insufficient (the `pending` push and events remain observable in-tx). Do not rely on EOA-only checks (weak on Hedera). At minimum, irreversibly consume/burn the entry *before* the PRNG draw so a revert still costs the entry.

---

### Finding 3 — Anti-rug solvency invariant omits accrued platform fees → admin double-withdraws the platform cut out of prize-obligated funds

- **Final severity: High.** Unanimous High across all three verifiers. **Directly breaks the anti-rug invariant's own arithmetic** — special prominence.
- **Location:** `_getMinStorageBalance` `LazyLotto.sol:1714-1718`; guarded withdraws `transferFungible` 1676-1711 / `transferHbarFromStorage` 1642-1670; `withdrawPoolProceeds` 1723-1736; `withdrawPlatformFees` **1753-1764 (no min-balance check)**; PoolManager `recordProceeds` 318-335 and `requestWithdrawal` 357-395.
- **What & why.** The reserve is `ftTokensForPrizes[token] + pendingWithdrawals(token) + getPlatformBalance(token)`. But `recordProceeds` credits **only the owner share** to `pendingWithdrawals`; `platformProceedsBalance` is credited *later*, inside `requestWithdrawal`, when the owner actually withdraws. So the platform cut *accrued* on proceeds whose owner has not yet withdrawn is reserved by **neither** term — even though Storage physically holds those tokens. `storageBalance − required` therefore equals exactly that un-reserved accrued platform cut, which `transferFungible`/`transferHbarFromStorage` will hand to the admin **without decrementing any proceeds counter.** When the owner share is later withdrawn (an admin can force this via `withdrawPoolProceeds`, since `requestWithdrawal` authorizes admins), the same cut rolls into `platformProceedsBalance` and is paid **again** by `withdrawPlatformFees` — which performs *no* `_getMinStorageBalance` check and pulls from whatever remains, i.e. prize funds.
- **Exploit / impact path (worked).** Token T: `ftTokensForPrizes[T]=100`, community pool with 100 un-withdrawn proceeds at 10% fee (owner 90 / platform 10); storage=200, `pendingWithdrawals=90`, `platformBalance=0`. (1) `transferFungible(T, admin, 10)`: required = 100+90+0 = 190; 200−10 = 190 ≥ 190 → passes; storage=190. (2) `withdrawPoolProceeds(pool, T)`: owner paid 90 (storage=100), `platformBalance=10`, `pendingWithdrawals=0`. (3) `withdrawPlatformFees(T)`: sends 10 from storage's 100 → storage=90, but `ftTokensForPrizes[T]` is still 100. A prize winner's `claimPrize` now reverts (90 < 100). The admin extracted 20 where only 10 was legitimate revenue — **10 of prize-obligated tokens stolen.** The siphon scales to the full fee percentage (≤25%) of all outstanding proceeds per token. Affects HBAR and generic-FT pools; $LAZY proceeds live in LGS (see Finding 9).
- **Preconditions.** Admin key (all three entry points are `_requireAdmin`-gated).
- **Fix.** Reserve the accrued-but-unmoved platform cut. Either track a global `accruedPlatformFees[token]`, incremented in `recordProceeds` by `amount*fee/100` and decremented in `requestWithdrawal` when it rolls into `platformProceedsBalance`, and add it to `_getMinStorageBalance`; **or** reserve the *full* un-withdrawn proceeds (owner + platform) per token. Additionally, add the `_getMinStorageBalance` safety check to `withdrawPlatformFees`, `withdrawPoolProceeds`, and `withdrawGlobalPoolProceeds` so no withdrawal path can drop storage below prize + proceeds obligations.

---

### Finding 4 — Admin free entries (`adminGrantEntry` / `adminBuyAndRedeemEntry`) are not restricted to global pools → admin drains community-pool prizes for free

- **Final severity: High.** Merged from three finder instances; verifier verdicts High-leaning (a minority rated Medium on the probabilistic-drain argument, but the deterministic combination with Finding 1 restores High). **Defeats the "admins cannot extract community pool prizes" guarantee** — special prominence.
- **Location:** `adminGrantEntry` `LazyLotto.sol:734-745`; `adminBuyAndRedeemEntry` `720-728`; free path in `_buyEntry` 1445-1480 (payment/`recordProceeds` block skipped at `if (!isFreeOfPayment)` L1461, yet `outstandingEntries`/`userEntries` still credited L1477-1478); prize award `_roll` 1551-1573; owner-routing protection that is bypassed: `removePrizes` 633-637.
- **What & why.** Both functions call `_buyEntry(..., isFreeOfPayment=true, recipient)` and gate only on `_requireAdmin()` + `_requireValidPool()`. `_requireValidPool` (269-276) checks existence and `!closed` only — it does **not** distinguish community from global pools. So an admin can mint unbounded zero-cost entries into any *community* pool (whose prizes were funded by a third-party owner), then roll and claim. Even with honest randomness, unlimited free rolls statistically strip the inventory at no cost; combined with Finding 1's rigged PRNG it is deterministic and total. The protocol elsewhere carefully routes removed community-pool prizes back to the pool owner (`removePrizes`, L633-637) precisely to prevent admin extraction — this protection is fully bypassed because the admin simply *wins* the prizes first.
- **Exploit / impact path.** Community owner funds pool #7 with 5,000 LAZY + a rare NFT. Admin calls `adminGrantEntry(7, 100000, adminAddr)` (free), then `rollBatch(7, …)`, wins the prizes, and `claimAllPrizes()` withdraws them. The owner receives zero proceeds and loses all funded prizes.
- **Preconditions.** Admin key.
- **Fix.** Restrict both functions to global pools, e.g. `require(poolManager.getPoolOwner(poolId) == address(0))`, mirroring the `CannotWithdrawFromGlobalPools` distinction already enforced on the withdrawal side. If admin comps into community pools are genuinely desired, require the pool owner's authorization and/or have the contract pay the entry fee into the pool so the owner is made whole. Emit events on all free-grant operations.

---

### Finding 5 — Admin can seize any community pool via `transferPoolOwnership` and drain the owner's proceeds (and prizes)

- **Final severity: High.** Verifier verdicts High/Medium/High. **Defeats the anti-rug guarantee that removed prizes/proceeds belong to the pool owner** — special prominence.
- **Location:** `transferPoolOwnership` `LazyLottoPoolManager.sol:484-504` (admin branch 488-491; only guards are `newOwner != address(0)` at 493 and `CannotTransferGlobalPools` at 494 — **no self-transfer guard, no owner consent, no outstanding-proceeds check**). Monetized via `LazyLotto.withdrawPoolProceeds` (1723-1736) → `requestWithdrawal` (357-395); prize path via `removePrizes` recipient = `getPoolOwner(poolId)` (633-644).
- **What & why.** `transferPoolOwnership` authorizes `isAdmin(msg.sender)` to reassign the owner of any *community* pool to an arbitrary address, including the admin's own. Setting `poolOwners[poolId] = adminAddress` makes the admin the pool owner; `withdrawPoolProceeds` then sees `owner == caller == admin`, computes the owner share of accrued entry-fee proceeds, and pays it to the (now-admin) pool owner — stealing the original owner's earned proceeds with no close required and no invariant to stop it. If the pool is idle (`outstandingEntries == 0` and pool-token `totalSupply == 0`), the admin can also `closePool` + `removePrizes`, whose recipient is now `getPoolOwner = admin`, extracting the community pool's FT/NFT prizes.
- **Exploit / impact path.** Community owner Bob's pool has accrued proceeds owed to him. Admin calls `transferPoolOwnership(poolId, adminAddr)`, then `withdrawPoolProceeds(poolId, token)` → owner share paid to `adminAddr`; `withdrawnProceeds` is bumped so Bob can never reclaim them. If idle, admin closes it and `removePrizes` ships all remaining prizes to `adminAddr`.
- **Preconditions.** Admin key.
- **Fix.** Do not let admins unilaterally reassign community-pool ownership to an arbitrary address. Require the current owner's authorization for transfers (or a two-step accept), forbid `newOwner == msg.sender` in the admin branch, and separate operational control (e.g. emergency close) from proceeds/prize *entitlement* so a reassignment cannot redirect already-accrued owner proceeds or prize refunds to the admin.

---

### Finding 6 — Batch rolling silently forfeits winning tickets when winners exceed remaining prizes *(user fund loss)*

- **Final severity: Medium.** Verifier verdicts Medium/Low/Medium — Medium reflects real, unprivileged fund loss occurring in ordinary operation. **Anonymously reachable.**
- **Location:** `_roll` `LazyLotto.sol:1551-1574` (loop); guard `if (won && totalPrizesAvailable > 0)` at 1555; `totalPrizesAvailable--` at 1567; entries debited up-front at 1504-1505; `Rolled(...,won=true,...)` emitted unconditionally at 1553. Reachable via `rollAll` (761-774), `rollBatch` (779-801), `buyAndRollEntry` (682-695).
- **What & why.** `outstandingEntries` and `userEntries` are decremented by the *full* `numberToRoll` before the loop. Inside the loop, `won` is computed independently of prize availability, but a prize is granted only while `totalPrizesAvailable > 0`. There is **no `else` branch**: once the pool's prize array empties mid-batch, every further winning ticket is consumed, emits `won=true`, yet produces no `PendingPrize` and no refund/re-credit. Single-ticket rolls are safe (a fully-empty pool reverts `NoPrizesAvailable` at L1492 *before* the debit), but that guard is a one-time pre-loop snapshot and does not cover mid-batch depletion. Off-chain systems also record phantom wins from the unconditional `Rolled(won=true)` event.
- **Exploit / impact path.** Pool has 2 prizes, 100% win rate. Alice buys 5 entries (pays 5× fee), calls `rollBatch(pool, 5)`. Tickets 1-2 win the 2 prizes; tickets 3-5 roll `won=true` with `totalPrizesAvailable == 0` and are consumed with nothing. Alice paid for 5, received 2; 3 entries lost. Reachable whenever winners exceed remaining prizes — `rollAll` on a large balance, a popular pool depleting between buy and roll, or concurrent rollers in one block.
- **Preconditions.** None; ordinary user, ordinary operation.
- **Fix.** Cap the number of winning payouts to remaining prizes and either (a) refund the entry fee for winning-but-unfillable tickets, (b) re-credit those entries to `userEntries`/`outstandingEntries` for a later roll, or (c) revert the whole batch when `numberToRoll` could exceed available prizes. At minimum, stop emitting `won=true` for tickets that receive nothing.

---

### Finding 7 — `pending[]` claim path is O(n²) and `transferPendingPrizes` allows unbounded force-feeding → griefing DoS on claims

- **Final severity: Medium.** Verifier verdicts Medium/Low/Medium. Not permanent fund loss (single-index `transferPendingPrizes` is an O(1) escape hatch), but the intended claim UX can be gassed out and legitimate heavy winners hit the wall unassisted. **Anonymously reachable.**
- **Location:** `_claimPrize` full-array copy `LazyLotto.sol:1578` (`PendingPrize[] memory userPending = pending[msg.sender];`); `claimAllPrizes` loop 965-974; `transferPendingPrizes` append to arbitrary recipient 990-1007 (esp. the max-branch).
- **What & why.** `_claimPrize` copies the caller's **entire** `pending` array — structs with nested dynamic `nftTokens`/`nftSerials` arrays — from storage into memory, though it needs only `.length` and one element (both readable directly from storage; the swap-pop at 1590-1593 already operates on storage). Cost scales linearly with array length on *every* claim; `claimAllPrizes` loops `_claimPrize(0)`, making a full clear O(n²). Separately, `transferPendingPrizes` lets **any** user push prizes onto **any** `pending[recipient]` with no cap and no opt-in.
- **Exploit / impact path.** Attacker cheaply manufactures thousands of trivial self-funded prizes (create a community pool, add hundreds of 1-base-unit LAZY prizes — LAZY is near-zero value — win them via free/cheap rolls) and calls `transferPendingPrizes(victim, MAX)` repeatedly, bloating `pending[victim]` until a single `claimPrize` copy exceeds the block gas limit. The victim can no longer use `claimPrize` / `claimAllPrizes` / `claimPrizeFromNFT`. Recovery exists but is painful (drain one-by-one via single-index `transferPendingPrizes` to fresh wallets).
- **Preconditions.** None; anonymous griefer. Legitimate large winners also hit the O(n²) wall with no attacker.
- **Fix.** In `_claimPrize`, read `pending[msg.sender].length` and `pending[msg.sender][pkgIdx]` directly from storage instead of copying the whole array. Refactor `claimAllPrizes` to a bounded, index-ranged batch claim that does not re-copy. Gate `transferPendingPrizes` with a pull/accept model or a per-recipient cap on externally-pushed entries so recipients cannot be force-fed.

---

### Finding 8 — `_moveNFTsWithHbar` emits one `TokenTransferList` per serial with a repeated token ID → multi-serial single-collection NFT prizes always revert

- **Final severity: Low.** All three verifiers downgraded the finder's Medium to Low: the mechanism is confirmed and the feature is broken for a common case, but it is **fail-closed** (atomic revert, HTS response code checked at L825, no fund loss or stranded state).
- **Location:** `LazyLottoStorage.sol:789-821` (per-serial `TokenTransferList` construction; `transfers` sized to `serials.length` at 790, `transfers[i].token = collectionAddress` with a single-element `nftTransfers` per serial); `cryptoTransfer` at 823; response check at 825-826.
- **What & why.** `_batchMoveNFTs` always passes serials from a *single* collection. Any batch with ≥2 serials builds multiple `TokenTransferList` entries all carrying the same token ID. Hedera rejects this with `TOKEN_ID_REPEATED_IN_TOKEN_LIST` ("Same TokenIDs present in the token list"), so the `cryptoTransfer` reverts. The correct encoding is **one** `TokenTransferList` per collection containing multiple `NftTransfer` entries. As written, the `MAX_NFTS_PER_TX = 8` batching design is non-functional for the common case of several serials from one collection.
- **Exploit / impact path.** A pool creator calls `addPrizePackage(poolId, token, amount, [collA], [[1,2]])` to bundle two serials of one collection as a prize. The build produces two same-token lists; `cryptoTransfer` reverts and the prize cannot be added. Add and claim are symmetric, so no funds are stranded — but multi-serial single-collection NFT prizes are simply impossible.
- **Preconditions.** Pool creator / prize manager (partially reachable by any user who can create a community pool).
- **Fix.** Rebuild the transfer list as a single `TokenTransferList` per collection with an `nftTransfers` array of length = number of serials (aggregate serials of the same token), keeping combined legs within Hedera's 10 balance-adjustment / 20 ownership-change limits.

---

### Finding 9 — *(Contested)* $LAZY prize/proceeds obligations are measured against Storage but held in the shared `LazyGasStation` → anti-rug invariant provides zero collateral protection for the primary token

- **Final severity: Low / Informational (contested).** **The split:** two lenses ruled this *not a vulnerability of the audited contracts* (Informational / NotAVuln) because LazyLotto cannot itself extract that LAZY — `transferFungible(LAZY)` routes through Storage, whose LAZY balance is ~0, so the vacuous check enables no theft *by LazyLotto*, and every LAZY payout is gated behind a legitimate obligation. One lens ruled it a real Low: the *documented headline guarantee* ("admins cannot steal prizes") is materially weaker for $LAZY than users would assume, because the backing collateral sits in a shared, non-segregated pool outside the invariant's measurement. Reported here because it bears directly on the anti-rug posture for the token the system most depends on.
- **Location:** `_getMinStorageBalance` `LazyLotto.sol:1714-1718`; LAZY deposit path `_pullPayment` 1236-1243 (`drawLazyFrom` → LGS); LAZY payout `_transferToken` 1767-1775 (`payoutLazy` from LGS); `transferFungible` measures `IERC20(token).balanceOf(storageContract)` 1676-1711.
- **What & why.** For $LAZY, deposits (entry fees, prize funding) are pulled into the `LazyGasStation`, and payouts are made from LGS via `payoutLazy`; LAZY never accumulates in `LazyLottoStorage`. Yet the solvency accounting sums `ftTokensForPrizes[LAZY] + pendingWithdrawals[LAZY] + platformBalance[LAZY]` and checks them against `IERC20(LAZY).balanceOf(storageContract)` — a balance that is ~0. The "admins cannot steal prizes" math is therefore vacuous for LAZY: it neither tracks nor protects the treasury that actually backs LAZY prizes. The real collateral sits in LGS, a **shared, non-segregated** pool used by multiple contract-consumers and drainable by any LGS admin via `retrieveLazy()`, or depletable by other consumers' `refillLazy`. There is no on-chain guarantee that LGS holds ≥ the LazyLotto LAZY obligations.
- **Exploit / impact path.** Users fund LAZY prizes; `drawLazyFrom` moves that LAZY into the shared LGS balance. A compromised (or merely over-subscribed) LGS admin calls `retrieveLazy(attacker, balance)`. LazyLotto's `ftTokensForPrizes[LAZY]` still shows the obligation, but the LAZY is gone; winners' `claimPrize` hits `payoutLazy → Empty()` and can never be paid. The Storage-based invariant never fires because it watches the wrong contract. Note: LGS is *trusted context*, so under the trust assumption this is a documentation/scoping gap rather than a live exploit of the audited contracts — hence the contested rating.
- **Preconditions.** LGS admin compromise, or ordinary LGS depletion by other consumers.
- **Fix.** Either custody LAZY prize/proceeds funds in a segregated balance the invariant actually measures, or extend the solvency check to LGS (assert `IERC20(LAZY).balanceOf(LGS) >= _getMinStorageBalance(LAZY)` before LAZY payouts and before any LGS drawdown affecting LazyLotto), and restrict `LGS.retrieveLazy` so it cannot draw below outstanding LazyLotto LAZY obligations. At minimum, **document explicitly** that LAZY prizes are only as solvent as the shared gas station and that the anti-rug invariant excludes LAZY.

---

### Finding 10 — *(Contested)* Unwrapped external calls and unbounded HTS subcalls in `calculateBoost` can brick all rolling

- **Final severity: Low / Informational (contested).** **The split:** two lenses ruled NotAVuln — the bonus-token set is admin-only (`setNFTBonus`/`removeNFTBonus` are `isAdmin`-gated), so an attacker cannot inject a reverting token; a bad entry is admin self-sabotage that yields nothing and is fully recoverable via `removeNFTBonus`; and the specific LDR revert path the finder posited does not trigger for the arguments `calculateBoost` passes. One lens confirmed a real Low under the impact lens: *if* triggered (a misconfigured/reverting bonus token, the immutable LDR misbehaving on some input, or ~25 bonus tokens × up to 2 subcalls each pushing the transaction past Hedera's per-tx gas/subcall ceiling), the effect is a genuine DoS on the core roll path since `calculateBoost` runs on every roll.
- **Location:** `calculateBoost` `LazyLottoPoolManager.sol:680-727` (unwrapped `IERC721(tkn).balanceOf` and `ILazyDelegateRegistry.getSerialsDelegatedTo` at 700-704, `IERC20(lazyToken).balanceOf` at 714); invoked by every roll at `LazyLotto.sol:1486`; token set bounded by `MAX_NFT_BONUS_TOKENS = 25` via `setNFTBonus` 764-785.
- **What & why.** Every roll calls `poolManager.calculateBoost(msg.sender)`, which loops over up to 25 admin-configured NFT bonus tokens making unwrapped external calls (no try/catch), plus a LAZY balance call. A reverting configured token or LDR input would revert the whole roll (claims unaffected). Up to ~50 HTS/precompile subcalls in `calculateBoost` alone, on top of two PRNG calls and prize transfers in `_roll`, could approach Hedera's per-transaction subcall/gas budget once many bonuses are configured.
- **Exploit / impact path.** An admin (or over-eager config) adds ~20-25 bonus tokens, or one bonus token is a contract that reverts on `balanceOf`; subsequent rolls revert with no gas refund until an admin removes the offending entry. Requires admin misconfiguration — not attacker-injectable — which is why the majority ruled it not a standalone vulnerability.
- **Preconditions.** Admin misconfiguration of bonus tokens.
- **Fix.** Wrap each external bonus lookup in try/catch and skip on failure; cap the number of bonus tokens evaluated per roll and bound total subcalls to stay within Hedera limits; consider snapshotting/computing boost off the hot roll path.

---

## 4. Caveats

- **This is an automated multi-agent adversarial review, not a substitute for a formal audit.** Findings were generated and cross-verified by AI agents against source; line references were spot-checked but not exhaustively re-derived for every claim.
- **No fuzzing, symbolic execution, or formal verification** was performed. In particular, the accounting invariant (Finding 3), the Hedera subcall-budget concern (Finding 10), and the HTS encoding issue (Finding 8) warrant on-network integration tests and property-based fuzzing before mainnet.
- **Trusted-context assumptions matter.** `LazyGasStation`, the PRNG precompile, and HTS were assumed to behave correctly except where the audited contracts' guarantees explicitly depend on them (Finding 9). A change in those assumptions can alter severities.
- **Privileged-role findings are real.** Findings 1, 3, 4, 5 (and the admin prong of 9) are gated behind an admin key, but each is a clean rug/odds-rigging path for a *single* compromised or malicious admin, and the on-chain access control is 1-of-N with no enforced multisig or timelock. Do not discount them because they require a role — the documented anti-rug guarantees assert they are impossible, and they are not.
- **Recommendation:** commission an independent professional audit and remediate at least all High findings (1-5) and the anonymously-reachable Medium findings (6-7) before, or immediately after, any mainnet value is at risk.