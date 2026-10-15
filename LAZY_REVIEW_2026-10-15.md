# Multi-agent review, 2026-10-15

Adversarial review of LazyTradeLotto v2, the hardened Mission template (Farms branch `fix/mission-eoa-code-delegation`), the off-chain signer tooling, and Hedera-specific bypasses. Nine agents ran: one finder and one verifier per area (Mission, TradeLotto, off-chain, Hedera lens), then a lead reviewer who deduplicated and ranked the results. They confirmed 30 findings, and the verifiers added 12 more. Live tracking is in `LAZY_HARDENING_ROADMAP.md`.

**Outcome:** the project decided to move every Lazy draw to a two-stage commit → settle design (`LAZY_TWO_STAGE_DRAW_DESIGN.md`) instead of relying on caller checks, which can't keep up with new network features. Findings that concern live contracts and that the redesign addresses are tracked privately and are not reproduced here.

## Refuted: atomic-batch grinding

Three areas first reported that a player could wrap a roll in a HIP-551 atomic batch with a later transaction that fails on a bad outcome, then retry. **This doesn't work on today's network.** Since v0.76 (mainnet ~2026-08-28), a batch may contain at most one EVM transaction, and it must be the last one. So nothing can run after the roll. Mirror scans found no violations since the rule shipped. The `tx.origin` check is not what stops it, and the docs have been corrected to say so.

## Findings (lead reviewer's ranking, lightly edited)

### HIGH

**H-M1 — Mission deterministic collection-level re-roll via allowance / auto-association (M2 + MV1).** *Blocks redeploying the Mission template. Batch-independent — works with a plain standalone call.*
`claimRewards` delivers the drawn NFTs and *then* calls `leaveMission`, which returns the staked NFTs through `batchMoveNFTs` and reverts (`NFTTransferFailed`) if it can't. The claimant controls which draws deliver (association) and how much allowance / how many free auto-association slots exist, so they arrange things such that the claim **only commits when the wanted collection was drawn**:
- Allowance lever (M2): each successful withdrawal spends 1 tinybar of the receiver's HBAR allowance; a failed delivery spends none. Set the allowance to exactly one `leaveMission` batch, un-associate the wanted collection. If the unwanted collection is drawn it delivers, `leaveMission` then has no allowance left and reverts → retry; if the wanted one is drawn it goes to "owed" (allowance untouched), `leaveMission` succeeds → commit.
- Auto-association lever (MV1): dissociate the requirement/gem collection after staking and leave exactly one free auto-assoc slot. An unwanted draw auto-associates and consumes the slot, so `leaveMission` can't return the requirement NFT → revert; a wanted draw commits. Needs no allowance trick.
Location: `Mission.sol:705-731`, `:785-801`; `TokenStaker.sol:154-161`; `BoostManager.sol:327-339`. M4 (below) makes it worse: all `nbOfRewards` rewards come from one collection, so one success selects the whole claim.
- **Fix (cheap, ~0 bytes):** reorder `claimRewards` so `leaveMission()` (and the slot/counter decrements) run **before** the draw loop, leaving the non-reverting deliveries as the last user-dependent step. Best fix: never deliver inside `claimRewards` — always record owed and deliver in `collectOwedRewards` (also closes H-M2/M3). Add regression tests for both levers. Verify on the local Hardhat harness (the finder's `mv/poc.js` reproduces it) and on testnet.

### MEDIUM

**M-Odds — lazy-trade sends odds/amounts in display units to the signer; every v2 roll would revert or pay 10× wrong (O3 + O4 + OV4).** *Functional blocker for the v2 rollout even after the contractId fix.*
`getWinRates` returns `winRate/1e8`, `jackpotRate/1e8`, `minWin/10`, `maxWin/10` (`lazyTradeLotto.ts:522-525`). Those fractional values are what get signed and passed to `rollLotto`. `ethers` rejects a fractional `uint256` ("underflow"), so rolls fail at signing; where a sum happens to be integer, amounts are 10× too small and the cap/threshold self-checks compare mismatched units. Separately, a ticket's `maxWinAmount` is the **sum** of `maxWin` across all true bonus flags, but the checklist says to set `LOTTO_MAX_WIN_CAP` from a single largest row — multi-collection holders get refused or revert `BadArguments("Win Cap")`. And the client re-derives the signed fields from its own cached odds instead of using the exact values the server signed (OV4), so an odds change between the two splits client and signer.
- **Fix:** keep tickets in contract units end-to-end and scale only in the UI; or convert in one shared helper (`winRate = round(x*1e8)`, `amount = round(x*10^dec)`) used by both signer and client, asserting `Number.isInteger` and the caps before signing. Return every signed field from the roll mutation and have the client pass them verbatim. Define the cap as `max over reachable flag combinations of Σ maxWin` in base units. Add a lazy-trade test built from a real `LazyLottoOdds` row. Rewrite Signer Guide §1/§5 and checklist line 16. Verify: `getLottoTicket(<testnet ticket>)` prints integer base-unit values and a multi-collection ticket rolls without reverting.

**M-Reroll2 — Mission owed path is gas-selective; a tight gas limit rejects chosen collections (M3 + H3).** *Mission redeploy. New angle on accepted item (a).*
The owed branch does ~5 cold SSTOREs + a LOG3 (~70–112k gas) that a successful delivery does not, and the HTS transfer costs the same whether it succeeds or fails (priced from the body). The claimant chooses which collection fails (association), so with the gas limit just above the delivered-path cost, every unwanted draw runs out of gas and reverts. Accepted item (a) assumed a tight limit only rejects incidentally-expensive outcomes; here the player chooses which outcome is expensive. Location: `Mission.sol:704-720`.
- **Fix:** reserve worst-case gas before each draw (`if (gasleft() < nbOfRewards * OWED_PATH_RESERVE + TAIL) revert`), or use the uniform "always owed, deliver in collect" path. Verify on testnet by binary-searching the gas limit on a 2-collection mission.

**M-Dup — Ticket re-key enables a second payout after any redeploy (O2 + OV3).** *Gate on re-keying tickets + any v2→v3 redeploy.*
The only thing that marks a ticket complete is the client's best-effort `lotto.complete` call; on-chain `history` is per contract. Today the contractId filter accidentally isolates tickets per contract. The checklist proposes keying tickets by trade source so they survive a redeploy — which removes that isolation, so every ticket rolled on the old contract with `complete=false` (skipped, or honestly failed) becomes signable and payable again on the new one. OV3 shows honest failures are common: the `complete` auth token expires at the same instant as the roll deadline, so a roll that lands near the deadline succeeds on-chain but can't be marked complete, leaving a zombie ticket that re-signs every 3 minutes and reverts `AlreadyRolled`.
- **Fix:** before signing, compute `keccak256(abi.encodePacked(token,serial,nonce,buyer))` and read `history()` on the current contract **and every previous lotto contract id** in config; if any is true, mark complete server-side and refuse to sign. Give the complete token a longer TTL than the deadline. Verify: a ticket rolled on one contract cannot be signed again after re-key.

**M4 — Mission reuses the same PRNG seed every loop iteration (M4 + H4).** *Mission redeploy.*
0x169 returns one seed per transaction, and `claimRewards` passes constant `userSeed` 0 and 1 every iteration (`Mission.sol:676-684`), so a multi-reward claim takes **all** rewards from one collection until it empties. Correct expected value, wildly wrong variance, and it amplifies H-M1/M-Reroll2 (one re-roll selects all `k`). Confirmed against mainnet PRNG-wrapper logs (one distinct seed across 10/20/27 calls in a tx).
- **Fix:** fetch one seed per claim and derive each index locally (`keccak256(seed, i)`), or use distinct `userSeed = 2*i / 2*i+1`. This also removes the `lo==hi` short-circuit edge (MV2) and cuts child records. Verify: a multi-reward claim produces a mix of collections.

### LOW

- **L-Cfg1 — TradeLotto config bounds (T3 + O8, T4, T5).** Confirmed from source: `payoutWindowCap` is only checked `!= 0` (so a cap below `maxJackpotPool` makes every jackpot hit revert `PayoutCapReached` and re-arm, while `getPayoutWindow` shows full headroom); `updateMaxJackpotPool` has no bound and doesn't clamp the live pool; `deadline` has no upper bound (a ms/s slip creates never-expiring signatures); `burnPercentage` has no `<= 100` cap (over 100 makes every non-exempt win revert in `LazyGasStation.payoutLazy` and re-arm). All owner-misconfig, all cheap. **Fix:** enforce `payoutWindowCap >= maxJackpotPool + maxWinAmtCap` in the constructor and all four setters; clamp `jackpotPool`/`_initialJackpot` to `maxJackpotPool`; `require(deadline <= block.timestamp + MAX_TTL)`; `require(percentage <= 100)`. Mirror the cross-checks in the deploy/admin scripts. Do these before deploying v2.
- **L-PRNG-range — deployed PRNG wrapper is exclusive, unlike the repo source (T7 + TV1).** I confirmed on mainnet: `0.0.8257116.getPseudorandomNumber(0,2,*)` returns only {0,1}, never 2; `(500,500)→500`, `(0,0)→0`. It computes `lo + choice % (hi-lo)` (commit `e86584a`), but today's `PrngSystemContract.sol:53` is inclusive (`hi-lo+1`). So on the deployed wrapper **`maxWinAmt` is never paid**, `P(win) = (T+1)/1e8`, and a `threshold = 0` row still wins ~1/1e8 (both comparisons use `threshold >= roll`). The finder's "mock mismatch" was backwards — the mock matches production, the in-repo source does not. **Fix:** either deploy a fresh wrapper from current source for v2 and record its id, or keep `0.0.8257116` and document `[min, max)` and the real win odds for the signer/odds-table/UI. If `0` must mean "disabled", use `threshold > 0 && threshold >= roll`.
- **L-OwedCollect — Mission `collectOwedRewards` is all-or-nothing and child-record-capped (M5 + HV1 + H6).** One undeliverable entry (frozen/KYC/paused/deleted collection) blocks every owed serial for that wallet, and `withdrawRewards` refuses owed serials so nobody can rescue them. Each entry is one HTS child record; past ~50 the call hits `MAX_CHILD_RECORDS_EXCEEDED` (I saw the "production defaults (3 preceding, 50 following)" comment in a node test). Becomes Medium if you adopt the "always owed" fix without fixing collect. **Fix:** add `collectOwedReward(index)` / `collectOwedRewards(maxCount)` that skips failures, and group same-collection serials into one transfer.
- **L-BurnResolver — burn-exemption resolver breaks for big stakers (O5 + OV1 + OV2).** `checkNFTDelegationIsValidBatch` does one `ownerOf` (one child record) per serial at 300k gas; I confirmed 50 serials pass, 51 returns `MAX_CHILD_RECORDS_EXCEEDED`. A burned/deleted serial in the list reverts the whole call (`ownerOf` reverts) and can never be revoked. And `getSerialsDelegatedToRange` **panics for any offset > 0** — I confirmed `range(0,2)` works and `range(1,1)` reverts Panic 0x32 on mainnet (`LazyDelegateRegistry.sol:518-531` writes `serials[j]` instead of `serials[j-_offset]`), so the obvious pagination fix doesn't work. All latent today (largest current delegate list is 39). **Fix:** fetch the full list with `getSerialsDelegatedTo`, drop mirror-reported deleted serials, check validity client-side in chunks of ≤45, return true on first valid. Document the fail-closed policy in Guide §2.
- **L-Mirror — resolver/signer turn mirror errors into silent wrong answers (O6), and `delegation_address` guidance is wrong (O7 + H7).** A transient mirror error makes the burn resolver read balance as 0 (signs `burnExempt=false` on an irreversible roll), and lazy-trade caches a long-zero fallback address forever (every later roll for an ECDSA-alias user reverts `InvalidTeamSignature`). Separately, Guide §6 says `delegation_address` "is null for every account"; I confirmed the live mirror **omits the field**, so a literal `!== null` check refuses every roller. **Fix:** retry mirror then throw (don't cache fallbacks); treat an account as delegated only when the value matches `^0x[0-9a-fA-F]{40}$` and is non-zero.
- **L-Alias — test scripts sign the long-zero roller; ECDSA-alias operators fail while the pre-flight says OK (T6 + O9 + H5).** `generateSignature.js` uses `toSolidityAddress()`; the "digest parity" pre-flight hashes the same wrong roller, so it can't catch it. Test tooling only; ED25519 operators unaffected. **Fix:** resolve a `0.0.x` roller to the mirror `evm_address` and print both forms.

### INFO

- **I-Fallback (TV2):** `fallback() external payable` returns SUCCESS for any unknown/stale selector, so lazy-trade's `verifyRollTxOnChain` (payer + SUCCESS + CONTRACTCALL + entity_id only) can mark a ticket complete for a call that never rolled. **Fix:** remove/`revert` the fallback (keep `receive()`); verify completion by reading `history()` or requiring a `LottoRoll` log.
- **I-Events (T8):** after the zero-payout fix, a 0-amount "win" emits `LottoRoll` with `winRoll <= threshold` but `winAmount 0`, and an empty-pool jackpot emits no `JackpotWin`; indexers that infer wins from rolls will over-count. `getPayoutWindow` returns a stale start after expiry. Document `_winAmount`/`JackpotWin` as authoritative; return start `0` when expired; fix the "only with lottoLossIncrement == 0" comment.
- **I-Tests (O10):** the pre-existing negative tests `fail()` only on SUCCESS and their `expect`s sit in never-run catch blocks (they pass on any revert); the random-signature test can't produce `InvalidTeamSignature` (OZ reverts with `Error(string)`); lines ~2258/2414 compare base-unit pool with whole-unit increment; the zero-jackpot fix (commit 7623403) has no testnet test. The local harness passes 15/15. **Fix:** assert `result[0].status.name` (+ `args[0]`); sign a valid digest with a different key for the bad-sig case; add testnet tests for `updateJackpotLossIncrement(0)` + two 100% jackpot rolls and for `minWinAmt=0`.
- **I-Guide/Deploy nits (O11 + OV5):** Guide §3 treats `resolveBurnExempt` (returns an object) as a bool — ethers packs an object as `true`, so a loose port signs everyone exempt; §4 error table omits the OZ `Error(string)` revert; duplicate `addContractUser` step; `getLottoInfo.js` swallows HTTP errors and hides the v2 caps section. `lazyLottoDeployAll --include-trade-lotto` silently reuses whatever `LAZY_TRADE_LOTTO_CONTRACT_ID` holds (v1) and re-adds it to LazyGasStation. **Fix:** destructure `{ burnExempt }`; add the error row; gate reuse on `maxWinAmtCap()` existing; clear the env var before a v2 deploy.

### Watch list

- **HIP-1195 account hooks**: owner-impersonating code that runs on transfers. Disabled on mainnet; testnet had them briefly (Feb–Apr 2026). Same family as HIP-1340 delegation; the two-stage design covers both.

- **HIP-1340 (EIP-7702) code delegation**: shipped switched off (v0.77). Covered by the two-stage design.

## Fix plan and status

| # | Findings | Item | Repo | Status |
|---|---|---|---|---|
| 3 | M2, MV1 | Mission: run leaveMission before the draw loop (or always-owed) | hedera-SC-LAZY-Farms | Open: folded into the Mission two-stage rework |
| 4 | O3, O4, OV4 | lazy-trade: sign odds/amounts in contract units, cap as sum over flags | lazy-trade (+ docs) | Open (lazy-trade); documented in Signer Guide §1 "Units" |
| 5 | T3, O8, T4, T5 | TradeLotto: add the four config bounds and script cross-checks | hedera-SC-lazy-lotto | **Fixed** (TradeLotto v2 branch) |
| 6 | O2, OV3 | lazy-trade: authoritative completion via history() before signing/re-key | lazy-trade (+ checklist) | Open (lazy-trade); documented in the ship checklist |
| 7 | M4, H4, MV2 | Mission: one PRNG seed per claim, derive indices locally | hedera-SC-LAZY-Farms | Open: folded into the Mission two-stage rework |
| 8 | M3, H3 | Mission: make per-draw gas outcome-independent | hedera-SC-LAZY-Farms | Open: folded into the Mission two-stage rework (settle has no player-controlled gas lever) |
| 9 | M5, HV1, H6, MV3 | Mission: bounded / index-based collectOwedRewards | hedera-SC-LAZY-Farms | Open: Mission rework |
| 10 | T7, TV1 | Resolve PRNG wrapper range semantics for v2 | hedera-SC-lazy-lotto (+ docs) | **Fixed** (defaults → `0.0.10583667`); moot for v2 if the redesign drops the PRNG |
| 11 | O5, OV1, OV2 | Burn resolver: chunk, skip deleted serials, avoid range offset>0 | hedera-SC-lazy-lotto (+ lazy-trade signer) | **Fixed** (`getUserBurn.js`); lazy-trade port open |
| 12 | O6, O7, H7, T6, O9, H5 | Mirror error handling, delegation_address check, and alias roller resolution | hedera-SC-lazy-lotto + lazy-trade | **Fixed** (scripts + guide); lazy-trade `resolveEVMAddress.ts` open |
| 13 | TV2, T8, O10, O11, OV5 | Info cleanups: fallback, events, tests, guide/deploy nits | hedera-SC-lazy-lotto + lazy-trade | **Fixed** (fallback, view, tests, guide, deploy-all); lazy-trade parts open |

### Fix details

**3. Mission: run leaveMission before the draw loop (or always-owed)** (hedera-SC-LAZY-Farms)
- Where: contracts/Mission.sol:666-732
- Change: Reorder claimRewards: requireEOA -> time check -> slotsAvailable-- and totalSerialsAsRewards -= nbOfRewards -> leaveMission() -> draw loop (deliver or owed) -> broadcastMissionComplete. Preferred: remove inline delivery entirely and always record owed, delivering only in collectOwedRewards.
- Verify: Local Hardhat harness (scratchpad review/mv/poc.js and poc2.js) must show the allowance and auto-association levers no longer let a claim commit selectively; testnet TE-3.

**4. lazy-trade: sign odds/amounts in contract units, cap as sum over flags** (lazy-trade (+ docs))
- Where: services/lazyTradeLotto.ts:514-526,359-372,413-422; server/api/routers/lotto.ts:94-110; services/lottoSigning.ts:113-127; LazyTradeLotto-V2_SIGNER_GUIDE.md:52-70,196; LazyTradeLotto-V2_SHIP_CHECKLIST.md:16
- Change: Convert winRate=round(x*1e8), amounts=round(x*10^dec) in one shared helper used by signer and client; assert Number.isInteger and Sigma maxWin<=maxWinAmtCap, Sigma winRate<=1e8, Sigma jackpotRate<=1e8 before signing; return every signed field from the roll mutation and have the client pass them verbatim; define LOTTO_MAX_WIN_CAP as max over reachable flag combinations of Sigma maxWin in base units. Rewrite Guide §1/§5 and checklist line 16 with explicit units.
- Verify: New lazy-trade test built from a real LazyLottoOdds row; getLottoTicket(testnet ticket) shows integer base-unit values; a multi-collection ticket rolls without reverting.

**5. TradeLotto: add the four config bounds and script cross-checks** (hedera-SC-lazy-lotto)
- Where: contracts/LazyTradeLotto.sol:150-168,311-313,563-584,624-649; scripts/deployments/deployLazyTradeLotto.js:260-290; scripts/interactions/LazyTradeLotto/admin/updatePayoutWindowCap.js, updateMaxJackpotThreshold.js, boostJackpot.js
- Change: Enforce payoutWindowCap >= maxJackpotPool + maxWinAmtCap in constructor + updatePayoutWindowCap + updateMaxJackpotPool + updateMaxWinAmtCap; clamp jackpotPool in updateMaxJackpotPool and _initialJackpot in the constructor; require(deadline <= block.timestamp + MAX_SIGNATURE_TTL); require(percentage <= 100) in constructor + updateBurnPercentage. Mirror the cap cross-check and INITIAL_LOTTO_JACKPOT <= maxJackpotPool in the scripts.
- Verify: Local Hardhat (scratchpad review/tradelotto/poc-config.js) must now revert each misconfiguration; a jackpot hit with pool>cap no longer bricks.

**6. lazy-trade: authoritative completion via history() before signing/re-key** (lazy-trade (+ checklist))
- Where: server/api/routers/lotto.ts:65,117-138; services/lottoSigning.ts:64-99,183-207; services/lazyTradeLotto.ts:306-314; LazyTradeLotto-V2_SHIP_CHECKLIST.md:26
- Change: Before signing, read history(keccak256(abi.encodePacked(token,serial,nonce,buyer))) on the current contract and every previous lotto contract id in config; if any is true, mark the ticket complete server-side and refuse to sign. Give the complete auth token a longer TTL than the roll deadline. Do this before re-keying tickets by trade source.
- Verify: A ticket rolled on contract A cannot be signed again after re-key/redeploy to B; a near-deadline roll gets marked complete on the next request instead of looping AlreadyRolled.

**7. Mission: one PRNG seed per claim, derive indices locally** (hedera-SC-LAZY-Farms)
- Where: contracts/Mission.sol:676-684
- Change: Fetch one seed per claim (getPseudorandomSeed) and derive colIdx/serialIdx from keccak256(seed,i) per iteration (skip modulo when len==1), or pass distinct userSeed 2*i and 2*i+1.
- Verify: Local harness: a multi-reward claim over >=2 collections yields a mix, not all-from-one; child records drop.

**8. Mission: make per-draw gas outcome-independent** (hedera-SC-LAZY-Farms)
- Where: contracts/Mission.sol:704-720
- Change: If keeping inline delivery, reserve worst-case gas before each PRNG call (if gasleft() < nbOfRewards*OWED_PATH_RESERVE + TAIL revert); or adopt the always-owed path from priority 3 so the owed SSTOREs are not outcome-conditional.
- Verify: Testnet TE-4: measure gas_used for an associated vs unassociated claim on the same mission; the owed path must not be grind-selectable under a tight limit.

**9. Mission: bounded / index-based collectOwedRewards** (hedera-SC-LAZY-Farms)
- Where: contracts/Mission.sol:756-777; contracts/TokenStaker.sol:95-117,126
- Change: Add collectOwedReward(uint256 index) and/or collectOwedRewards(uint256 maxCount) that process from the tail, skip (keep) failed entries instead of reverting, and group same-collection serials into one <=8-NFT transfer; optionally apply refill() at the start. Fix the misleading 'needs no LAZY/hbar' comment for fixed-fee collections.
- Verify: Testnet: a wallet with >50 owed entries can drain them across calls; one frozen collection does not block the others.

**10. Resolve PRNG wrapper range semantics for v2** (hedera-SC-lazy-lotto (+ docs))
- Where: contracts/PrngSystemContract.sol:49-53; scripts/deployments/deployLazyTradeLotto.js:149-155; LazyTradeLotto-V2_SIGNER_GUIDE.md (odds table)
- Change: Either deploy a fresh PRNG wrapper from current (inclusive) source for v2 and record its id in .env, or keep 0.0.8257116 and document [min,max) plus P(win)=(T+1)/1e8 for the signer/odds-table/UI. If 0 must disable a tier, use threshold>0 && threshold>=roll. Keep the mock exclusive while pointing at 0.0.8257116.
- Verify: Mirror call on the chosen wrapper (scratchpad confirmed 0.0.8257116 is exclusive); odds table matches the deployed behaviour.

**11. Burn resolver: chunk, skip deleted serials, avoid range offset>0** (hedera-SC-lazy-lotto (+ lazy-trade signer))
- Where: scripts/interactions/LazyTradeLotto/queries/getUserBurn.js:76-90; contracts/LazyDelegateRegistry.sol:406-431,518-531
- Change: Fetch the full delegated list via getSerialsDelegatedTo at higher gas, drop mirror-reported deleted serials (GET tokens/{id}/nfts/{serial}), check validity client-side in chunks of <=45, return true on first valid. Do NOT call getSerialsDelegatedToRange with offset>0 (it panics). Document the fail-closed policy in Guide §2.
- Verify: scratchpad review/offchain gasProbe shows 51-serial batch failing; chunked resolver returns a result for a 60+ serial staker; rangeProbe confirms offset>0 panic avoided.

**12. Mirror error handling, delegation_address check, and alias roller resolution** (hedera-SC-lazy-lotto + lazy-trade)
- Where: utils/hederaMirrorHelpers.js:290-317,880-901; scripts/.../queries/getUserBurn.js:59,65-66; scripts/.../testing/generateSignature.js:172-186,245-247; rollLottoTest.js:101-110; lazy-trade/services/resolveEVMAddress.ts:41-52; LazyTradeLotto-V2_SIGNER_GUIDE.md:171
- Change: Retry mirror then throw (never cache fallback addresses); resolve a 0.0.x roller to mirror evm_address (print both forms) and compare in the pre-flight; treat an account as delegated only when delegation_address matches ^0x[0-9a-fA-F]{40}$ and is non-zero; update Guide §6 and add unit tests for absent/null/0x/real.
- Verify: ECDSA-alias operator rolls successfully in rollLottoTest; a mirror 429 makes the signer retry/refuse rather than sign a guessed roller.

**13. Info cleanups: fallback, events, tests, guide/deploy nits** (hedera-SC-lazy-lotto + lazy-trade)
- Where: contracts/LazyTradeLotto.sol:800-802,535-538,443-452,469-471; test/LazyTradeLotto.test.js:1273-1468,2258,2414; scripts/.../queries/getLottoInfo.js:79-87; lazy-trade/services/lottoSigning.ts:183-205; scripts/deployments/lazyLottoDeployAll.js:299-316
- Change: Remove/revert fallback() (keep receive()) and verify completion via history()/LottoRoll log; document _winAmount/JackpotWin as authoritative and return window start 0 when expired; assert result[0].status.name in negative tests and sign a bad digest with a different key; fix base-unit vs whole-unit assertions; destructure {burnExempt}; add the OZ Error(string) row; gate deployAll trade-lotto reuse on maxWinAmtCap() existing and skip re-adding to LGS.
- Verify: npx hardhat run scratchpad/tlv2-local-check.js still 15/15; negative tests fail if the wrong error fires; a stale-selector call no longer marks a ticket complete.

## Testnet experiments

- TE-3 (confirms H-M1): a 2-collection mission; as the claimant, un-associate the wanted collection and set the HBAR allowance to exactly one leaveMission batch (and separately the auto-association-slot variant); call claimRewards repeatedly and confirm whether only wanted-collection draws commit. Expected after the reorder/always-owed fix: claims commit regardless of outcome.
- TE-4 (settles M3/H3 and MV2 magnitudes on real Hedera gas): two claims on one mission, one associated to the drawn collection and one not; compare mirror-node gas_used for the delivered path vs the owed path, and a 1-serial vs many-serial draw, to size OWED_PATH_RESERVE.
- TE-5 (settles L-OwedCollect/M5/HV1): accumulate ~55 owed entries for one wallet in one mission (nbOfRewards and repeated enter/claim with delivery failing), then call collectOwedRewards and confirm MAX_CHILD_RECORDS_EXCEEDED, and that the bounded/index-based version drains them across calls.
- TE-6 (settles L-BurnResolver cap on mainnet override): confirm the live maxFollowingRecords by checking the largest serial count at which checkNFTDelegationIsValidBatch succeeds on the deployed registry (read-only estimateGas already shows 50 ok / 51 fails on the public mirror; confirm against a mainnet archive node if the mirror override differs).
- Block-hash validation for the two-stage design: see the validation plan in `LAZY_TWO_STAGE_DRAW_DESIGN.md`.
