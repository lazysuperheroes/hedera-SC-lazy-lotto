# Lazy Superheroes — EOA-Guard Hardening Roadmap

**Start here** to pick up the October 2026 hardening work across the Lazy contracts and apps. Written 2026-10-14. Each workstream ends with a ready-to-paste prompt for a new Claude Code session.

## Why this exists

Several Lazy contracts draw randomness with Hedera's PRNG and settle the outcome **in the same transaction**: LazyLotto rolls, LazyTradeLotto rolls, Mission reward draws, ForeverMinter / MinterContract serial selection. Anything that can run code after the outcome, inside the same atomic unit, can inspect it and revert a bad result to re-roll for free. The defence is an EOA-only guard, `msg.sender == tx.origin`. Two Hedera features weaken that guard:

| Bypass | Status | Effect on `tx.origin == msg.sender` |
|---|---|---|
| **HIP-551 atomic batches**: `[roll, check-that-fails-on-loss]` rolls back together | Live from ~Oct 2025; **closed Sept 2026** (a batch may hold one contract call, and it must be last). Contract calls in batches are due to be removed entirely ~March 2027 | Bypassed while open. LazyLotto v2 was checked clean: `scripts/interactions/Utilities/checkBatchRerolls.js` found 501 calls from 22 callers with no batch use (2026-10-14) |
| **HIP-1340 (EIP-7702) code delegation**: an EOA runs delegated code that calls the contract, then reverts | **Shipped switched off** in consensus node v0.77 (mainnet 2026-09-29). HIP approved, not final, **no activation date**. v0.78 (testnet 2026-10-08) does not enable it | Bypassed once enabled: the delegated EOA is still `tx.origin`. Delegation can be set by type-4 tx **or plain HAPI `CryptoUpdate`**, so ED25519 accounts can delegate too |

**The fix**: also require `msg.sender.code.length == 0`. Verified on mainnet 2026-10-14: ED25519 and ECDSA EOAs report 0 bytes of code, contracts their real size, and HTS tokens 23 bytes, the same `0xef0100‖address` delegation pointer format a delegated EOA will show. So the check is harmless today. It was also proven on a local EVM: an EOA carrying a 7702 delegation pointer is rejected. HIP-1340's text does not spell out `EXTCODESIZE` explicitly, so **validate on Hedera testnet when it is enabled** before relying on it.

Where we chose to keep single-transaction results ("you know what you won immediately") over commit-reveal: LazyLotto and LazyTradeLotto. Commit-reveal stays the fallback if Hedera ever adds another way to compose code after a call.

## Status board

| Contract / app | Repo · location | Live? | Guard today | Plan | When | State |
|---|---|---|---|---|---|---|
| **Mission template** | hedera-SC-LAZY-Farms · branch `fix/mission-eoa-code-delegation` | Factory live; **no live missions** | old template: `tx.origin` on enter only | New template: `tx.origin` + `code.length` on enter & claim, owed-reward fallback (stops the un-associate re-roll), `getOwedRewards` / `collectOwedRewards` | **Now** | Built, uncommitted, needs testnet run → [Workstream A](#a-now-mission-template-redeploy) |
| **ForeverMinter** | hedera-SC-minter · `contracts/ForeverMinter.sol:529` | **Not live**; non-upgradeable | `tx.origin` only | Add a codeless-caller switch **before mainnet launch** | **Launch gate** | Not started → [Workstream B](#b-launch-gate-foreverminter--mintercontract) |
| **MinterContract** | hedera-SC-minter · `contracts/MinterContract.sol:385` | **Not live**; non-upgradeable | `tx.origin` only | Same as ForeverMinter | **Launch gate** | Not started → Workstream B |
| **LazyTradeLotto v2** | hedera-SC-lazy-lotto · branch `feat/lazytradelotto-v2` (`29bb507`) | Not deployed | `tx.origin` + owner switch `setRequireCodelessCaller` (off) | Ship after the lazy-trade signer/frontend work; at HIP-1340 just turn the switch on | When lazy-trade is ready | Committed, testnet suite not yet run → [Workstream C](#c-lazytradelotto-v2-ship) |
| **LazyTradeLotto v1** `0.0.9109659` | — | Paused, **decommissioned** | — | Nothing: paused, removed from LazyGasStation (tx `0.0.6284762@1792011961.147310417`), holds 0 HBAR / no tokens / no allowances, never rolled | — | Done |
| **LazyLotto v2** `0.0.10628505` | hedera-SC-lazy-lotto · `contracts/LazyLotto.sol:1490` | **Live** | `tx.origin` only | V3: add `code.length == 0` to the guard (fits: ~145 bytes spare), redeploy + migrate. Keeps instant results | **When HIP-1340 hits testnet** | Watching → [Workstream D](#d-watch-hip-1340-activation) |
| **lazy-trade** (app) | ~/github/lazy-trade | Live | — | TradeLotto v2 signer + client; fix ticket `contractId` mismatch | With Workstream C | Not started |
| **lazy-dapp-v3** | ~/github/lazy-dapp-v3 | Live | — | Mission owed-rewards UI; TradeLotto v2 address; launch-plan doc | With A and C | Not started |

## A. Now: Mission template redeploy

Everything is in **`~/github/hedera-SC-LAZY-Farms/MISSION_TEMPLATE_V2_PICKUP_PROMPT.txt`** (paste it into a session in that repo). In short: run `npm run test-farms` on testnet → commit → `scripts/deployments/configureFarms-NewMissionTemplate.js` on testnet then mainnet (MissionFactory `0.0.8257122`) → SDK/CLI `MISSION_TEMPLATE` (now `0.0.10646220`) + ABI + owed-rewards methods + release → lazy-dapp-v3 owed-rewards UI and `OnlyEOA` handling.

## B. Launch gate: ForeverMinter + MinterContract

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

On branch `feat/lazytradelotto-v2` (commit `29bb507`). Full task list: **`LazyTradeLotto-V2_SHIP_CHECKLIST.md`**. Signer/frontend spec and test vector: **`LazyTradeLotto-V2_SIGNER_GUIDE.md`**. Both are on that branch until it's merged.

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
| LSH Gen1 / Gen2 / Gen1 Mutant | `0.0.768753` / `0.0.848553` / `0.0.1693200` |
| $LAZY | `0.0.1311037` |

**Chain IDs:** 295 mainnet, 296 testnet, 297 previewnet, 298 local.

**Audit reports:** `LazyLotto-AUDIT_REPORT.md`, `LazyTradeLotto-AUDIT_REPORT.md` (this repo).
