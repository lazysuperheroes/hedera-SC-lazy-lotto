# Lazy Superheroes — Hardening Roadmap

**Start here** to pick up the October 2026 hardening work across the Lazy contracts and apps. Written 2026-10-14, revised 2026-10-15 after a multi-agent review. Each workstream ends with a ready-to-paste prompt for a new Claude Code session.

> **2026-10-15: direction changed.** The review concluded that caller checks can't keep up with new network features that let code run around a same-transaction draw (HIP-1340 delegation and HIP-1195 hooks are the visible ones). The decision is to stop relying on caller checks altogether: **every Lazy draw moves to a two-stage commit → settle design** whose outcome comes from a future block's hash. Design: **`LAZY_TWO_STAGE_DRAW_DESIGN.md`**. Review findings and fix status: **`LAZY_REVIEW_2026-10-15.md`**. The sections below the status board are kept for history where they describe the earlier `code.length` plan.

## Why this exists

Several Lazy contracts draw randomness with Hedera's PRNG and settle the outcome **in the same transaction**: LazyLotto rolls, LazyTradeLotto rolls, Mission reward draws, ForeverMinter / MinterContract serial selection. Anything that can run code after the outcome, inside the same atomic unit, can inspect it and revert a bad result to re-roll for free. The defence is an EOA-only guard, `msg.sender == tx.origin`. Two Hedera features weaken that guard:

| Bypass | Status | Effect on `tx.origin == msg.sender` |
|---|---|---|
| **HIP-551 atomic batches**: `[roll, check-that-fails-on-loss]` rolls back together | Live from ~Oct 2025; **closed Sept 2026** (a batch may hold one contract call, and it must be last). Contract calls in batches are due to be removed entirely ~March 2027 | Bypassed while open. LazyLotto v2 was checked clean: `scripts/interactions/Utilities/checkBatchRerolls.js` found 501 calls from 22 callers with no batch use (2026-10-14) |
| **HIP-1340 (EIP-7702) code delegation**: an EOA runs delegated code that calls the contract, then reverts | **Shipped switched off** in consensus node v0.77 (mainnet 2026-09-29). HIP approved, not final, **no activation date**. v0.78 (testnet 2026-10-08) does not enable it | Bypassed once enabled: the delegated EOA is still `tx.origin`. Delegation can be set by type-4 tx **or plain HAPI `CryptoUpdate`**, so ED25519 accounts can delegate too |

**The fix**: also require `msg.sender.code.length == 0`. Verified on mainnet 2026-10-14: ED25519 and ECDSA EOAs report 0 bytes of code, contracts their real size, and HTS tokens 23 bytes, the same `0xef0100‖address` delegation pointer format a delegated EOA will show. So the check is harmless today. It was also proven on a local EVM: an EOA carrying a 7702 delegation pointer is rejected. HIP-1340's text does not spell out `EXTCODESIZE` explicitly, so **validate on Hedera testnet when it is enabled** before relying on it.

~~Where we chose to keep single-transaction results ("you know what you won immediately") over commit-reveal: LazyLotto and LazyTradeLotto. Commit-reveal stays the fallback if Hedera ever adds another way to compose code after a call.~~ Superseded 2026-10-15: new network features keep adding ways to compose code around a call, so all draws move to two stages. With a keeper settling automatically, players still sign once and see the result in about 4–6 seconds.

| Bypass (added 2026-10-15) | Status | Effect |
|---|---|---|
| **HIP-1195 account hooks** | Disabled on mainnet; testnet had them briefly (Feb–Apr 2026) | Same family: owner-impersonating code that can revert on a bad outcome |


## Status board

| Contract / app | Repo · location | Live? | Plan | State |
|---|---|---|---|---|
| **Two-stage draw design** + `LazyDrawBeacon` | `LAZY_TWO_STAGE_DRAW_DESIGN.md` | — | Owner decisions (keeper, expiry, caller checks, TradeLotto option) → testnet blockhash validation → build the beacon → adversarial review | **Proposal** → [Workstream F](#f-two-stage-draws) |
| **LazyTradeLotto v2** | hedera-SC-lazy-lotto · branch `feat/lazytradelotto-v2` (PR #12) | Not deployed | Convert `rollLotto` to commit + settle before it ships; keep the review fixes | Review fixes committed (`21ca4d3`); **blocked on F** → [Workstream C](#c-lazytradelotto-v2-ship) |
| **Mission template** | hedera-SC-LAZY-Farms · branch `fix/mission-eoa-code-delegation` (uncommitted) | Factory live; **0 clones** | Rework to two stages (claim returns staked NFTs first, then settle draws into owed); needs ~size cuts | Review found the owed fallback alone still allows a re-roll; **redeploy deferred to F** → [Workstream A](#a-now-mission-template-redeploy) |
| **ForeverMinter / MinterContract** | hedera-SC-minter (master) | **Not live**; non-upgradeable | **Launch gate:** two-stage mint (commit takes payment, settle picks serials/metadata) instead of the codeless switch | Not started → [Workstream B](#b-launch-gate-foreverminter--mintercontract) |
| **LazyLotto v2** `0.0.10628505` | hedera-SC-lazy-lotto · `contracts/LazyLotto.sol:1490` | **Live**, unpaused (owner decision 2026-10-15) | V3 = two-stage + new Storage/PoolManager + a sunset path; v2 wind-down needs holders to roll (see design doc) | Watching; forensics clean (567 calls, 22 plain wallets, none nested/batched) |
| **LazyNFTStaking** `0.0.7221488` | hedera-SC-LAZY-Farms · `contracts/LazyNFTStaking.sol` | **Live**, 1,593 NFTs / 86 stakers; non-upgradeable | Custody safe; exits depend on LGS paying 33.5M accrued LAZY (LGS holds 13.5M); single-key owner. Ops fixes now; migration options A/B/C | Audit done; dApp hand-off doc written (private repo) → [Workstream G](#g-lazynftstaking-audit) |
| **LazyTradeLotto v1** `0.0.9109659` | — | Paused, **decommissioned** | Nothing: paused, removed from LazyGasStation (tx `0.0.6284762@1792011961.147310417`), holds 0 HBAR / no tokens / no allowances, never rolled | Done |
| **lazy-trade** (app) | ~/github/lazy-trade (branch `v2-contract` exists) | Live | TradeLotto signer + client: units bug, history-based completion, resolver port, ticket `contractId` mismatch | Not started; documented in the signer guide and checklist |
| **lazy-dapp-v3** | ~/github/lazy-dapp-v3 | Live | "Drawing…" UX + keeper; Mission owed-rewards UI; TradeLotto v2 address | Waits on F |

## A. Now: Mission template redeploy

> **2026-10-15: deferred into Workstream F.** The review showed the owed-reward fallback still leaves a deterministic re-roll (the reverting `leaveMission` runs after the draw, and the player controls whether it fails via allowance or auto-association slots), and the draw reuses one seed per iteration. The two-stage rework fixes both; the pickup prompt below is superseded for the draw parts.

Everything is in **`~/github/hedera-SC-LAZY-Farms/MISSION_TEMPLATE_V2_PICKUP_PROMPT.txt`** (paste it into a session in that repo). In short: run `npm run test-farms` on testnet → commit → `scripts/deployments/configureFarms-NewMissionTemplate.js` on testnet then mainnet (MissionFactory `0.0.8257122`) → SDK/CLI `MISSION_TEMPLATE` (now `0.0.10646220`) + ABI + owed-rewards methods + release → lazy-dapp-v3 owed-rewards UI and `OnlyEOA` handling.

## B. Launch gate: ForeverMinter + MinterContract

> **2026-10-15: the launch gate is now the two-stage mint** (Workstream F; per-contract notes in the design doc). The codeless switch below is no longer sufficient on its own.

Both are non-upgradeable and not yet live, so **fix them before launch** and they never need a redeploy for HIP-1340. Use the LazyTradeLotto v2 pattern, an admin switch that is off by default. It assumes nothing about how Hedera implements 7702, and you turn it on once testnet confirms the behaviour:

```solidity
bool public requireCodelessCaller; // off until HIP-1340 is validated on testnet

function setRequireCodelessCaller(bool enabled) external onlyAdmin { requireCodelessCaller = enabled; /* + event */ }

// replace the H-1 guard in mintNFT (ForeverMinter.sol:529) / mint path (MinterContract.sol:385)
// solhint-disable-next-line avoid-tx-origin
if (msg.sender != tx.origin || (requireCodelessCaller && msg.sender.code.length != 0)) revert OnlyEOA();
```

- **Room**: both are ~20.5 KB (viaIR, runs 200), ~4 KB under the limit.
- **Tests**: extend the existing `contracts/test/MintCallerProbe.sol` cases. Add a local-EVM case that gives an EOA a 7702 delegation pointer (`hardhat_setCode(eoa, '0xef0100' + target)`) and expects `OnlyEOA` with the switch on and success with it off. LazyTradeLotto v2's checks used exactly this.
- **No owed-reward fallback needed**: each mint delivers from a single collection, so un-associating blocks every outcome equally and can't pick a serial. Revisit if a minter ever draws across several collections.
- Optional extra: an admin-settable mint cap per window, like TradeLotto's 24h payout cap, if a compromised admin or price misconfiguration is a concern.

Prompt:
```
In ~/github/hedera-SC-minter, before ForeverMinter / MinterContract go to mainnet, add an admin
switch `requireCodelessCaller` (default false) and extend the H-1 OnlyEOA guard to
`msg.sender != tx.origin || (requireCodelessCaller && msg.sender.code.length != 0)` in both mint
paths (ForeverMinter.sol:529, MinterContract.sol:385), with event, ABI refresh, tests (extend
MintCallerProbe; add a hardhat_setCode EIP-7702-designator case), size check, docs and
CHANGELOG. Background and rationale: ~/github/hedera-SC-lazy-lotto/LAZY_HARDENING_ROADMAP.md
(Workstream B). Pattern to copy: LazyTradeLotto v2 on branch feat/lazytradelotto-v2 in
hedera-SC-lazy-lotto (setRequireCodelessCaller).
```

## C. LazyTradeLotto v2 ship

> **2026-10-15:** the review fixes are in `21ca4d3` (cap rule, deadline bound, burn ≤ 100, no fallback, strict resolver, alias-aware scripts, test fixes). Shipping now waits for the two-stage conversion (Workstream F). The lazy-trade work in the checklist (units, history-based completion, resolver port, ticket `contractId`) can proceed independently.

On branch `feat/lazytradelotto-v2` (commits `29bb507` … `21ca4d3`). Full task list: **`LazyTradeLotto-V2_SHIP_CHECKLIST.md`**. Signer/frontend spec and test vector: **`LazyTradeLotto-V2_SIGNER_GUIDE.md`**. Both are on that branch until it's merged.

v2 adds:
- a signed `deadline`;
- contract and chain binding in the signed message;
- per-roll `maxWinAmtCap` and a 24h `payoutWindowCap`;
- a **signed `burnExempt`**, replacing the on-chain LSH and delegate-registry lookups (reference resolver: `queries/getUserBurn.js`);
- the `tx.origin` guard plus the `setRequireCodelessCaller` switch.

Order:
1. Testnet: `ENVIRONMENT=test npm run test-trade-lotto`, then deploy, `addContractUser`, and `testing/rollLottoTest.js`.
2. Choose `LOTTO_MAX_WIN_CAP` and `LOTTO_PAYOUT_WINDOW_CAP`, and create a **new** mainnet signing key.
3. lazy-trade:
   - **ticket `contractId` mismatch first.** The scanner writes `LAZY_TRADE_SC` `0.0.8051302`, but the reader filters on `LAZY_TRADE_LOTTO`. This is likely why v1 never rolled.
   - odds rows for the v2 contract ID;
   - burn-exemption resolver, signer, client, ABI, self-checks, error mapping;
   - `config/addresses.ts` defaults.
4. lazy-dapp-v3 `src/config/addresses.ts:59`.
5. Mainnet deploy (paused), `addContractUser`, checks, unpause.

Prompt:
```
Ship LazyTradeLotto v2. In ~/github/hedera-SC-lazy-lotto on branch feat/lazytradelotto-v2, read
LazyTradeLotto-V2_SHIP_CHECKLIST.md and LazyTradeLotto-V2_SIGNER_GUIDE.md, run the testnet suite
(I have put testnet credentials in .env), then implement the lazy-trade signer/frontend changes in
~/github/lazy-trade per the guide, starting with the ticket contractId mismatch. Keep the
checklist updated as items complete.
```

## D. Watch: HIP-1340 activation

**Signals to watch** (testnet will come first):
- Hedera consensus node release notes: <https://docs.hedera.com/networks/release-notes/services>. Look for "HIP-1340" or "EOA code delegation" **enabled**.
- The "EIP-7702 is deactivated" callout on <https://docs.hedera.com/evm/development/deploying> disappearing.
- Mirror node accounts with a non-null `delegation_address`.

**Check the behaviour on testnet first.** Run this EXTCODESIZE probe against a delegated testnet account; expect `…17` (23 bytes). Plain accounts should still return 0.
```bash
M=https://testnet.mirrornode.hedera.com/api/v1; ADDR=<20-byte hex, no 0x>
curl -s -X POST "$M/contracts/call" -H 'content-type: application/json' \
  -d "{\"data\":\"0x73${ADDR}3b60005260206000f3\",\"estimate\":false,\"block\":\"latest\"}"
```

**Then act:**

| Item | Action |
|---|---|
| LazyLotto | Build V3 (guard + `code.length`), testnet, redeploy + migrate (v2 migration tooling exists). If mainnet activation lands first: **pause rolls** with `scripts/interactions/LazyLotto/admin/pauseContract.js` (claims still work while paused) |
| LazyTradeLotto v2 | `admin/setRequireCodelessCaller.js 0.0.<v2> on`. No redeploy |
| ForeverMinter / MinterContract | Turn their switch on (if Workstream B shipped); otherwise pause minting via `updatePauseStatus` |
| Mission (new template) | Already enforces `code.length`; just confirm a delegated account is rejected on testnet |

Prompt:
```
HIP-1340 (EOA code delegation) is now enabled on Hedera testnet. Follow Workstream D in
~/github/hedera-SC-lazy-lotto/LAZY_HARDENING_ROADMAP.md: verify delegated accounts report code on
testnet, then plan LazyLotto V3 (tx.origin + code.length guard), and the switch flips for
LazyTradeLotto v2 and the minters.
```

## F. Two-stage draws

**Design:** `LAZY_TWO_STAGE_DRAW_DESIGN.md`. Order:
1. Owner decisions listed in the design doc (keeper, expiry policy, caller checks, TradeLotto option).
2. Testnet validation of block-hash behaviour on consensus nodes (current block returns 0, previous 256 non-zero and stable, block interval) with a tiny probe contract. Needs testnet credentials.
3. Build `LazyDrawBeacon` + a shared commit/settle pattern; local adversarial tests (wrapper commits, wrapper settles then reverts, expiry, FIFO, draw-state lock).
4. Convert in this order: LazyTradeLotto v2 (smallest, not deployed) → Mission template (needs size cuts) → ForeverMinter / MinterContract (launch gate) → LazyLotto V3 (largest; new Storage/PoolManager; v2 wind-down plan).
5. Keeper (settle + anchor bot) and the "Drawing…" UX in the dApps.
6. Adversarial multi-agent review of the beacon and each converted contract before any deploy.

Prompt:
```
Continue Workstream F in ~/github/hedera-SC-lazy-lotto/LAZY_HARDENING_ROADMAP.md: read
LAZY_TWO_STAGE_DRAW_DESIGN.md and LAZY_REVIEW_2026-10-15.md, confirm the open owner decisions
with me, then build LazyDrawBeacon and convert LazyTradeLotto v2 (branch feat/lazytradelotto-v2)
to commit/settle with local adversarial tests. Keep the roadmap status board current.
```

## G. LazyNFTStaking audit

`0.0.7221488` holds users' staked NFTs and can't be upgraded. Audit 2026-10-15, in two lenses: custody/liveness/migration, and rewards/signatures. The deployed bytecode matches commit `a5c2a59`; `fd57ef7` changed comments only.

- **Owner decision 2026-10-15:** LGS funding is operational. If stakers can't exit, they ask the team and the LGS gets topped up, so no contract action is needed.
- **dApp hand-off:** `lazy-dapp-v3/docs/plans/STAKING_HARDENING_2026-10.md` (private repo). It covers signer changes and unstake pre-checks (allowance, NFTs per transaction, associations). The rewards-lens findings that concern the signer are documented there only, deliberately not in this public repo.

**Custody is safe; liveness is not.**
- **Nobody, the team included, can move, seize or force-return staked NFTs.** NFTs only move to their staker (or untracked serials to the owner). The contract's HAPI admin key is itself, so it can't be updated. Mirror holdings (1,593) match tracked serials and LDR delegations exactly.
- **Every exit pays the staker's full accrued $LAZY first, from the shared LazyGasStation (LGS), and reverts if that fails.** This is true of both `unstake` (signed) and `unstakeAnyNFT` (no signature). On 2026-10-15:
  - **86 stakers had 33.5M LAZY accrued** (recomputed independently from `calculateRewards`).
  - **The LGS held 13.54M**, shared with six other contracts.
  - Accrual runs at about 56k LAZY/day.
  - The six largest accruers alone (13.1M) roughly empty the LGS. After that, every exit with rewards reverts until the LGS is topped up.

| # | Finding | Severity | Mitigation for the live contract | Fix in a successor |
|---|---|---|---|---|
| F1 | Exits are tied to full reward payout from an under-funded, shared LGS | High | Keep LGS ≥ the largest single accrual at all times. Before any migration announcement, fund it to the total accrued (about +20M LAZY; SCT holds 223M) or decide openly to cut rewards. Alert when LGS < total accrued | Withdrawal never depends on payout; unpaid rewards become owed; dedicated reserve with solvency accounting |
| F2 | Single ED25519 key `0.0.6284762` owns staking **and** is the only LGS admin. It can brick every exit (`setPeriodForBonus(0)` → division by zero; `burnPercentage > 100`; removing the contract user; draining LGS), permanently if followed by `renounceOwnership` | High | **Change `0.0.6284762`'s Hedera account key to a threshold key list** (a CryptoUpdate; the account ID, and so every contract's owner/admin address, stays the same). That one change protects LazyLotto, LGS, staking and TradeLotto admin at once. Runbook: never call those setters or renounce | Bounded parameters, Ownable2Step, no renounce |
| F3 | Withdrawal spends 1 tinybar of the **user's HBAR allowance** per 8-NFT batch; without it the user sees only `NFTTransferFailed(1)` | Medium; **the most common real failure** (19 failed unstakes; 72 of 86 stakers have no allowance today) | dApp grants ≥ 100 tinybar (checking remaining `amount`, not `amount_granted`) before every unstake | Pre-check through the HAS system contract with a clear error |
| F4 | About 40 NFTs per transaction (50 child records); a 53-NFT unstake failed; 10 stakers hold > 40 | Medium | dApp chunks at ≤ 35 NFTs per transaction | One HTS call per batch, not per serial; enforced chunk size |
| F5 | Signed exit depends on the backend signer, and reverts (underflow) if it signs more than `userRewards` | Medium | Add `unstakeAnyNFT` to the dApp as "exit without signature" (never used on mainnet so far). The signer must sign stake-time rates | Store per-serial rates at stake time |
| F6 | The staking signer is trusted for reward rates; signer weaknesses could over-credit rewards and drain LGS (F1) | Medium | Signer hardening per the private dApp hand-off; hardware/KMS signer key; alerts on anomalous `userRewards` | Rates stored on-chain at stake time; EIP-712 signatures bound to contract, chain and nonce |
| F7 | LGS is shared, and contract users get removed during clean-ups (six removals so far, the latest 2026-10-14) | Medium | Hard rule: never remove `0.0.7221488` or drain `0.0.7221483` while anything is staked; monitor `isContractUser` | Dedicated reserve |
| F8 | Refill check routes exits through LGS if the contract's own HBAR or $LAZY falls below 20 units | Low | Never use its `transferHbar` / `retrieveLazy`; top up instead | — |
| F9–F12 | Third-party collection admin key (Meerkat could delete its token, stranding 69 serials); contract expiry/rent if Hedera enforces it (LDR holds 0 HBAR); one staker not associated with $LAZY; remote halving-array bound | Low | Monitor; fund contracts if rent is announced | — |
| F13 | Inherited HTS admin wrappers are callable by anyone (harmless while the contract holds no token keys) | Info | Never make it a key holder | Lite HTS base |
| F14 | Farms `docs/FRONTEND_AGENT_GUIDE.md` and `deployments/mainnet.json` listed wrong EVM addresses for LAZY, SCT, LGS, LDR and staking. Three were **unrelated ECDSA accounts**, and the guide told integrators to approve $LAZY to one of them | Info, but dangerous | **Corrected 2026-10-15** in the Farms working tree (uncommitted); no app was using them | — |
| F15 | Reward parameters apply retroactively to unclaimed periods | Info | A lever for winding down emissions, with obvious trust implications | — |

**Migration** (an admin-forced move is impossible, and a migrator contract can't work because unstake only pays `msg.sender`):
- **A. Withdraw-only legacy + voluntary migration with incentives (recommended).**
  - Remove all stakeable collections to stop new stakes; unstake doesn't check them.
  - The successor honours HODL tiers via a signed attestation captured before unstake.
  - Requires funding LGS for all accrued rewards, or an openly announced cut.
- **B. Virtual migration.** The NFTs stay put. A new rewards programme recognises them through `getStakedNFTs` / LDR delegation; old emissions are sunset with notice.
- **C. Keep `0.0.7221488` as the product** and fix only operations (threshold key, funding policy, dApp fixes).
- **Whatever the choice**, the old contract, its LGS user status, LGS funding, the LDR and a working unstake UI must stay live until the last NFT leaves, possibly forever (lost keys).

**Ops actions now, whichever option:**
1. Threshold key on `0.0.6284762`.
2. LGS funding policy and alert.
3. dApp unstake: auto allowance, chunking, an "exit without signature" option, and association pre-checks.

## E. Loose ends

- **Delete the mainnet admin `.env`** from `hedera-SC-lazy-lotto` (it holds `0.0.6284762`'s key; gitignored but on disk) before adding testnet credentials.
- **Merge** `chore/abi-refresh-and-hardening-roadmap`, which regenerates the stale `LazyLotto` / `LazyLottoPoolManager` ABIs, adds `checkBatchRerolls.js` and this roadmap. Also merge `feat/lazytradelotto-v2` when it ships.
- lazy-dapp-v3 `docs/plans/MAINNET_LAUNCH_PLAN.md`: update the Trade Lotto ID (line 50) and the LazyGasStation contract-user list (line 88); v1 was removed 2026-10-14.
- Tooling quirks in both contract repos:
  - `node_modules` in this repo was a stale yarn install; it was reinstalled from `package-lock.json` with `npm install --legacy-peer-deps` (existing hardhat-toolbox/typechain peer conflict).
  - `npx eslint` fails because ESLint 8.7 doesn't read the flat `eslint.config.mjs`.
- `checkBatchRerolls.js <contractId> --from <date>`: run it on ForeverMinter / MinterContract only if they ever ran before Sept 2026 (they haven't).

## Decisions log

| Date | Decision | Why |
|---|---|---|
| 2026-10-14 | Keep single-tx results for LazyLotto / TradeLotto; no commit-reveal | UX ("know immediately"); a `code.length` check covers 7702 without a second call |
| 2026-10-14 | Don't redeploy LazyLotto until HIP-1340 is testable on testnet | Validate real Hedera behaviour rather than guess |
| 2026-10-14 | Redeploy the Mission template now | No live missions, so it's cheap; also closes the un-associate re-roll |
| 2026-10-14 | Decommission TradeLotto v1 (pause + remove from LGS), build v2 | v1 never used; signatures never expired; payout bounds missing |
| 2026-10-14 | TradeLotto v2: owner switch for `code.length`, signed burn exemption, 24h payout cap | No redeploy at HIP-1340; removes six fragile lookups (TL-04/05); bounds a leaked signer (TL-03) |
| 2026-10-14 | ForeverMinter / MinterContract: add the switch before launch | Non-upgradeable and not yet live: cheapest time to fix |
| 2026-10-15 | Atomic-batch grinding is closed by the network, not by `tx.origin` | v0.76: a batch holds at most one EVM transaction, placed last. Docs corrected |
| 2026-10-15 | Leave LazyLotto v2 unpaused until V3 | Owner's call; forensics clean (all calls plain top-level transactions from ordinary wallets) |
| 2026-10-15 | **Move every draw to two stages (commit → settle from a future block hash)**, even if it needs a new shared contract | Caller checks lose to each new network feature; this holds whatever Hedera adds. Players still sign once with a keeper |
| 2026-10-15 | New contracts get a sunset path | v2's prize inventory and the staking contract's NFTs show the cost of having none |
| 2026-10-15 | `PRNG_CONTRACT_ID` default → `0.0.10583667` | `0.0.8257116` never returns its upper bound |

## Reference

**Mainnet IDs**

| Contract / account | ID |
|---|---|
| LazyLotto / LazyLottoStorage / LazyLottoPoolManager | `0.0.10628505` / `0.0.10628497` / `0.0.10628512` |
| LazyGasStation (admin `0.0.6284762`) | `0.0.7221483` |
| LazyDelegateRegistry | `0.0.7221486` |
| NFT staking | `0.0.7221488` |
| MissionFactory / Mission template | `0.0.8257122` / `0.0.10646220` |
| LazySecureTrade | `0.0.8051302` |
| LazyTradeLotto v1 (retired) | `0.0.9109659` |
| PRNG wrapper (inclusive; LazyLotto v2, Farms) / older (exclusive upper bound) | `0.0.10583667` / `0.0.8257116` |
| LazyLotto v1 legacy (dormant, 0 prizes) | `0.0.10584509` |
| LSH Gen1 / Gen2 / Gen1 Mutant | `0.0.768753` / `0.0.848553` / `0.0.1693200` |
| $LAZY | `0.0.1311037` |

**Chain IDs:** 295 mainnet, 296 testnet, 297 previewnet, 298 local.

**Audit reports:** `LazyLotto-AUDIT_REPORT.md`, `LazyTradeLotto-AUDIT_REPORT.md` (this repo).
