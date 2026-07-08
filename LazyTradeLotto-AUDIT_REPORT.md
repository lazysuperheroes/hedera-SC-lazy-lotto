# LazyTradeLotto — Final Security Audit Report

**Target:** `contracts/LazyTradeLotto.sol` (Hedera, Solidity `>=0.8.12`)
**Contract role:** Signature-gated, trade-triggered $LAZY lotto. Rolls are free to the user and authorized by a `systemWallet` ECDSA signature; all wins and jackpots are paid out of the shared **LazyGasStation (LGS)** $LAZY treasury.
**Date:** 2026-07-04
**Method:** Multi-agent adversarial review — per-vulnerability-class finders, then three independent verifier lenses (reachability, mitigation, impact) per finding. Only findings where at least one lens confirmed reality after adversarial refutation are reported here. Every code location below was re-read and confirmed against source during synthesis.

---

## 1. Executive Summary

### Scope
Only `LazyTradeLotto.sol` is in scope. `LazyGasStation` (treasury/payout + burn), `PrngSystemContract` (0x169 PRNG), `LazyDelegateRegistry` (LDR), and the LSH NFT collections are treated as **trusted first-party context**, but their *interaction surface* with LazyTradeLotto (unguarded external calls, stale-read semantics, shared treasury blast radius) is in scope and is where several findings live.

### Risk posture (honest)
LazyTradeLotto is well-structured for its threat model: it deploys **paused**, every roll requires an unforgeable `systemWallet` signature that binds `msg.sender`, `nonReentrant` is applied, and an early `history[hash]` write blocks intra-deployment replay. No finding lets an anonymous caller forge a payout or steal another user's signed roll.

However, the review surfaced **six distinct real issues**. The most consequential is a **confirmed Medium**: the anti-replay flag is written *before* the in-transaction PRNG draw and payout, so **any revert unwinds it** — an outcome-conditional contract caller can grind the PRNG (retry-until-win / retry-until-jackpot). Beyond that, the payout economics have **no on-chain guardrails**, so a compromised or buggy `systemWallet` hot key drains not just the jackpot but the **entire shared LGS treasury** in one transaction, and the signed message has **no chain/contract domain binding**, exposing the well-documented operational reality of `systemWallet` key reuse to cross-deployment replay.

**Reachable by an anonymous / unprivileged caller (called out per the brief):**
- **Burn-sink evasion (TL-05):** any user can self-delegate one LSH serial through the *permissionless* LDR, sell the NFT, and keep the **0% burn exemption forever**. No privilege required.
- **Payout availability / non-finality (TL-04 + TL-01 sub-case):** because winning payouts route through six unguarded external calls and there is **no owner setter** to swap a broken dependency, a misbehaving registry/collection **bricks all winning rolls** with no recovery short of a full redeploy; and while LGS is under-funded, **every honest winner's roll reverts and re-arms** (a "win" has no finality until the treasury can fund it). Losing rolls keep committing throughout, so the contract *looks* healthy while unable to pay anyone.

None of the issues permit theft of user principal (the contract custodies none) or bypass of the signature gate. But three of them convert a single trusted-key or single-dependency failure into an **unbounded or ecosystem-wide** loss, which is why they are reported rather than dismissed as "trusted."

### Severity roll-up
1 confirmed Medium · 4 contested Low · 1 Informational.

---

## 2. Findings Table

| ID | Severity (adjusted) | Location | Precondition / Role | Status |
|----|--------------------|----------|---------------------|--------|
| **TL-01** | **Medium** | `LazyTradeLotto.sol:209` (early `history[hash]=true`) vs draw `225` / payouts `360,387` | Grinding: `systemWallet` must have signed a roll whose `msg.sender` is an **attacker-controlled contract**. Non-finality sub-case: **any** honest winner when LGS is insolvent. | **Confirmed** (3/3 on primary finding) |
| **TL-03** | **Low** | `303-315`, `286-300`, `353-364`, `387-391` | `systemWallet` **hot-key compromise** OR a **buggy off-chain signer**. Blast radius = entire LGS. | Contested (2 "trusted model" vs 1 real-Low) |
| **TL-04** | **Low** | `getBurnForUser` `493-511`; called `363,390`; no setters for `74-78`, LSH immutable `67-71` | A trusted dependency (LDR / LSH token / PRNG / LGS) starts reverting or OOGs; or a winner accrues a huge delegated-serial list. No attacker privilege gate. | Contested (2 "trusted" vs 1 real-Low) |
| **TL-02** | **Low** | messageHash `303-315`; recover `321-328`; history key `200` | Same `systemWallet` key reused across **two live value-bearing deployments** (testnet+mainnet, or v1→v2), both LGS `contractUsers`. Replayer is the original `msg.sender`. | Contested (verifiers split Informational↔Medium across ~8 duplicate reports) |
| **TL-05** | **Low** | `getBurnForUser:493-511` → `LazyDelegateRegistry.getSerialsDelegatedTo` (no validity check) | **Anonymous / unprivileged** — any user, via permissionless LDR self-delegation. | Contested (2 real-Low vs 1 Informational) |
| **TL-06** | **Informational** | `boostJackpot:422-426`; clamp `411-414`; canonical emit `257` | `onlyOwner`. | Contested (2 real-Info vs 1 NotAVuln) |

---

## 3. Detailed Findings

---

### TL-01 — Anti-replay flag unwinds on revert → PRNG grinding (retry-until-win/jackpot) and non-final wins
**Final severity: Medium (Confirmed).** *Merges three reports flagged by different lenses — the "losing rolls only commit on success" grinding finding (3/3 real), the "signature not consumed on revert" finding, and the "payout failure re-arms the tuple" non-finality finding. All share one literal root cause.*

**Location:** `rollLotto` writes `history[hash] = true` at **line 209**, *before* `validateRollParameters` (212), *before* the PRNG draw at **225-226**, and *before* the payouts in `processRegularWin` (**360**) and `processJackpotWin` (**387**). The replay key is `hash = keccak256(token, serial, nonce, buyer)` (**line 200**) — it deliberately excludes `msg.sender` and the signature.

**What & why.** `history[hash]` is the *only* single-use guard; the `teamSignature` itself is never independently marked consumed. Because the flag and the payout live in the same atomic transaction with **no `try/catch`**, any revert after line 209 rolls the flag back, re-arming the exact `(token, serial, nonce, buyer)` tuple. The `systemWallet` signature covers only fixed parameters (`303-315`), so it stays valid and reusable for that same `msg.sender`. Critically, Hedera's PRNG (`getPseudorandomNumberArray`, backed by the 0x169 running-hash seed mixed with block timestamp) **re-draws fresh randomness on every resubmission** — confirmed by all lenses. So a caller that can observe its own outcome in-transaction and revert on a bad one gets unlimited independent re-rolls of the same signed tuple.

**Exploit path (grinding — the serious case).**
1. A `LazySecureTrade` trade party is, or is routed through, an attacker-controlled contract `C`, and the off-chain signer issues a roll signature for `msg.sender == C` (nothing on-chain forbids a contract `msg.sender`; the signature binds it at line 305, so the signer must have signed for `C`).
2. `C.roll()` calls `rollLotto(...)`, then inspects its own $LAZY balance delta (or watches for `JackpotWin`). If it did **not** win / did not hit the jackpot / did not draw a high enough amount, `C` reverts the whole transaction — unwinding `history[hash]`.
3. `C` resubmits. Each attempt gets a new PRNG seed. `C` repeats (paying only gas) until `winRolls[0] <= winRateThreshold` and/or `winRolls[1] <= jackpotThreshold`, converting a one-shot fair lottery into an effectively guaranteed maximum win / jackpot, drained from LGS.

An **EOA cannot exploit this**: for an EOA a losing roll simply *succeeds*, permanently burning the tuple — exactly one fair shot. The exploit is gated on the signer having signed a **contract** `msg.sender`.

**Exploit path (non-finality — reachable by any honest winner, no privilege).** When LGS is temporarily under-funded, `payoutLazy` reverts (`balance < amount`), unwinding `history[hash]`. A user who would have won the jackpot resubmits after the treasury refills and gets an **entirely fresh draw** — the original "win" had no finality. Win/loss, amount, and jackpot outcome can differ between attempts; on-chain stats and events therefore describe rolls that later resolve differently. This is an integrity/UX defect rather than theft, but it flows from the same line-209 root cause.

**Verifier split.** The primary grinding finding was confirmed by all three lenses (Medium/Low/Medium). The refuting verdicts on the merged reports objected only to *framing* (one argued the abstract "contract reverts on bad RNG" pattern needs the signer to sign for a contract — which is the stated precondition, not a refutation; another argued the non-finality case produces no double-pay — true, and it is reported as integrity, not theft). The load-bearing mechanics were never refuted. Net: **Medium**, precondition-gated.

**Fix.**
- Preferred: **decouple the outcome from settlement.** Draw and persist the result in a way that cannot be reverted based on the result, and pay via a pull-based claim, so a downstream payout revert cannot re-arm the tuple or re-draw randomness. A commit-reveal split achieves the same.
- Cheaper stop-gap for the grinding vector: **reject contract callers** in `rollLotto` (`msg.sender.code.length == 0`) so outcomes cannot be conditionally reverted. (`tx.origin == msg.sender` is discouraged; a code-size check is the targeted control.)
- Operationally, treat "the off-chain signer only ever signs resolved human EOAs" as a **documented security invariant**, since the stash→human resolve hop already exists in the pipeline.
- At minimum, document that a reverted roll re-arms the signature and provision LGS so winning rolls never revert on insolvency.

---

### TL-03 — Unbounded per-roll payout authority: a leaked or buggy `systemWallet` key drains the entire shared LGS treasury
**Final severity: Low (Contested; finder rated High).** *Reported prominently per the brief's signer-key-compromise mandate.*

**Location:** parameter bounds in `validateRollParameters` **286-300**; payouts at **360** (`processRegularWin`) and **387** (`processJackpotWin`).

**What & why.** Rolling is free to the user, yet every win is paid from LGS — the treasury backing the **entire Lazy ecosystem**, not just this lotto. The only on-chain checks on the signed parameters are: `token != 0 && serial != 0` (286), `minWinAmt <= maxWinAmt && maxWinAmt != 0` (290), `winRateThreshold <= 1e8` (294), `jackpotThreshold <= 1e8` (298). There is **no upper bound on `maxWinAmt`**, no minimum win-rate denominator, **no per-roll payout cap**, no rolling/aggregate cap on `totalPaid`, and no solvency/reserve accounting. The contract leans entirely on LGS's single `balance < amount` guard.

**Exploit path.** Precondition: the `systemWallet` ECDSA key — a **hot key operated by an automated off-chain service (high exposure)** — leaks, or the signer has a bug. Given that:
1. Attacker holds one LSH NFT so `getBurnForUser` returns `0` (line 507), sidestepping LGS's burn `SafeCast`.
2. Picks any unused `(token, serial, nonce, buyer)` tuple, sets `winRateThreshold = 100_000_000` (guarantees a win: line 351 `winRateThreshold >= randomRoll` for `randomRoll ∈ [0,1e8]`) and `minWinAmt = maxWinAmt = current LGS $LAZY balance`.
3. Self-signs (they hold the key), calls `rollLotto` once. `processRegularWin` draws `winAmt = maxWinAmt = LGS balance` and `payoutLazy` transfers the **entire treasury** at 0% burn. Fresh nonces repeat against any refill.

A **buggy** signer needs no malice: an off-by-`10^N` on $LAZY's 1-decimal scaling in `maxWinAmt` produces the same over-payment, and nothing on-chain bounds it. **Blast radius is the whole LGS $LAZY balance, not the notional `jackpotPool`.**

**Verifier split.** Two lenses correctly note this is the contract's *accepted, signature-gated trust model* — no untrusted path reaches a payout, `systemWallet` is fully trusted, and the key is rotatable via `updateSystemWallet` (481). The third lens confirms the code facts and rates it real-Low because there is **zero on-chain backstop** to bound a single-key failure. We adopt **Low** and foreground the blast radius: defense-in-depth here converts a total-treasury loss into a bounded one, which is precisely what a hot automated signer warrants.

**Fix.**
1. Owner-settable `maxWinAmtCap`; require `maxWinAmt <= maxWinAmtCap` in `validateRollParameters`.
2. Owner-settable maximum `winRateThreshold` for regular wins (or a minimum win-rate denominator).
3. Per-transaction and rolling-window aggregate payout caps tracked in this contract.
4. Keep these ceilings under the **owner** key, distinct from the low-privilege `systemWallet` hot key.

---

### TL-04 — `getBurnForUser` makes six unguarded external calls with no way to swap a broken dependency → any revert/OOG bricks all winning payouts
**Final severity: Low (Contested).**

**Location:** `getBurnForUser` **493-511**, invoked on every regular win (**363**) and jackpot (**390**). No setter exists for `lazyDelegateRegistry`, `prngSystemContract`, or `lazyGasStation` (mutable state at **74-78** but only `updateJackpotLossIncrement/MaxJackpotPool/BurnPercentage/SystemWallet` exist, **433-485**); `LSH_GEN1/GEN2/GEN1_MUTANT` are `immutable` (**67-71**).

**What & why.** Every winning roll computes the burn rate via six external calls with **no `try/catch`**: three `IERC721(LSH_*).balanceOf` and three `lazyDelegateRegistry.getSerialsDelegatedTo`. If any one reverts or OOGs, the whole `rollLotto` reverts and the winner cannot be paid. Two aggravators:
1. **No recovery.** If the immutable LSH token is deleted, or LDR is migrated/paused/upgraded such that `getSerialsDelegatedTo` reverts, **all** winning payouts are permanently bricked and the owner cannot repoint the lotto at a replacement — the only fix is redeploying the whole contract. Losing rolls never call `payoutLazy`, so they keep committing `history[hash]=true`, and the contract appears alive while silently unable to pay any winner.
2. **Unbounded read.** `getSerialsDelegatedToRange` in LDR materializes the full serial set via `.values()` before the `.length > 0` short-circuit, so a winner with a very large delegated-serial list can **OOG their own payout**. An attacker holding many LSH serials could delegate them all to a target winner to inflate that array and grief that winner's payout (though delegation also grants the exemption, limiting the incentive).

**Verifier split.** Two lenses downgrade to Informational/NotAVuln on the "trusted first-party dependency" argument (no external actor can make LDR/LSH revert; the common exemption case short-circuits at `balanceOf > 0` before ever reaching the registry). The third confirms the mechanism and rates real-Low, noting no user principal is custodied — a bricked payout locks no funds, capping severity. We adopt **Low**: the availability risk is real and unrecoverable-without-redeploy, but bounded to liveness of an un-funded-principal system.

**Fix.**
- Wrap the six reads in `try/catch` (or gas-capped `staticcall`) and treat any failure as "not exempt" — fall through to `burnPercentage` so a misbehaving dependency degrades gracefully instead of bricking payouts.
- Add `onlyOwner` setters (with `isContract` validation) for `lazyDelegateRegistry`, `prngSystemContract`, and `lazyGasStation`.
- Consider computing the burn rate off-chain and including it in the signed parameters, removing three collection reads + a registry read from the payout path entirely.

---

### TL-02 — Signed roll message has no domain separator (no `chainId` / `address(this)`) → cross-deployment / cross-chain signature replay
**Final severity: Low (Contested).** *This single root cause was independently flagged by ~8 finder reports; all are merged here.*

**Location:** `messageHash` construction **303-315**; `ECDSA.recover` compare **321-328**; replay key **200**.

**What & why.** The signed preimage is `keccak256(abi.encodePacked(msg.sender, token, serial, nonce, buyer, winRateThreshold, minWinAmt, maxWinAmt, jackpotThreshold))`, wrapped only with `toEthSignedMessageHash` (the EIP-191 `\x19` prefix — chain-agnostic). It binds **no `block.chainid`, no `address(this)`, and no EIP-712 domain (name/version/verifyingContract)**. The sole replay guard, `history[hash]`, is per-contract storage whose key *also* omits chain and contract. Therefore a `teamSignature` valid on one deployment is byte-for-byte valid on any **other** deployment that shares the same `systemWallet` signer key, because that second deployment has an independent, empty `history`. `validateRollParameters` never checks that `token` is a real collection (only `!= 0`), so almost any harvested signature is replay-usable elsewhere.

**Exploit path.** Team deploys v1 at address A with signer S, later deploys v2 at B reusing S, both registered as LGS `contractUsers`. A user completes a real trade and is paid on A. Because the signature omits `address(this)`/`chainid`, the same user (same EVM address — `msg.sender` is bound, so replay is self-only) submits the identical args + signature to `B.rollLotto`; B's `history` is empty, recovery matches S, and B pays a **second** time from B's LGS. Equivalently, a generously-signed **testnet** message replays on **mainnet** if the signer key is shared. Project operational notes confirm the `systemWallet` (`0x8Bf1…37d5`) and stack are **reused across the TestNet environment**, so key reuse is a realistic precondition rather than hypothetical, and this contract is non-upgradeable so any "v2" is a fresh deploy.

**Verifier split.** Reachability/impact lenses split repeatedly: several rated Informational/NotAVuln because the exploit requires an *operational* misconfiguration (two live deployments sharing one key) the contract doesn't force, and `history` + `msg.sender`-binding fully block intra-deployment and cross-user replay. Others rated it Medium/Low because the code omission is real and the key-reuse precondition is evidenced by the project's own ops. Weighing the strong intra-deployment mitigations against the documented key-reuse reality, we set **Low** — a genuine missing-domain-separator defect whose exploitability is entirely a function of key hygiene.

**Fix.**
- Adopt **EIP-712** with a domain separator fixing `{name, version, chainId, verifyingContract}` computed once in the constructor; or minimally add `block.chainid` and `address(this)` to the `abi.encodePacked` preimage (and require the off-chain signer to include them).
- Add `address(this)` / `chainid` to the `history[hash]` key for defense in depth.
- Operationally: **never reuse a `systemWallet` signing key across networks or redeployments.**

---

### TL-05 — Stale delegation reads grant a permanent burn exemption (anonymous burn-sink evasion)
**Final severity: Low (Contested — 2 of 3 lenses confirm).**

**Location:** `getBurnForUser` **493-511** (returns `0` when `getSerialsDelegatedTo(...).length > 0`, lines 498-505); depends on `LazyDelegateRegistry.getSerialsDelegatedTo`, a raw read that does **not** call `checkNFTDelegationIsValid`.

**What & why.** `getSerialsDelegatedTo` returns the stored delegated-serial set without re-validating current ownership — the registry's own NatSpec states such delegations "will show but be stale." The delegation record is therefore "sticky": a user who delegates an LSH serial (to themselves or a second address) and later transfers/sells that NFT continues to read a non-empty list forever, and `getBurnForUser` keeps returning `0`. In this **net-burner** token design, the burn is the deflationary sink; a sticky exemption erodes that sink on every winning roll for those users.

**Exploit path.** User A delegates one LSH serial to their own wallet via the **permissionless** LDR, then sells the NFT. `getSerialsDelegatedTo` still returns that serial, so A pays **0% burn on every future win** despite holding and validly-delegating nothing. **No privilege, no signature manipulation, no owner action** — reachable by any user.

**Verifier split.** Two lenses confirm all three links (consumer path, non-validating read, persistence) and rate Low. The third agrees on mechanics but rates Informational because the burn is only a haircut on the winner's *own* winnings — no treasury drain, and the exemption is freely obtainable anyway by simply holding an LSH NFT. We adopt **Low**: it is an unprivileged, permanent economic leak against the core deflationary mechanism, but strictly bounded (foregone burn ≤ `winAmt × burnPercentage` per win) and not theft.

**Fix.** Gate the exemption on a validity-checked registry call that confirms current ownership of the delegated serials, **or** drop the stale-serials path and rely on the direct `balanceOf` checks (which are already present in the same `||` expression), **or** explicitly accept and document the exemption as best-effort.

---

### TL-06 — `boostJackpot` emits the delta instead of the new total, and over-cap boosts silently evaporate
**Final severity: Informational (Contested).**

**Location:** `boostJackpot` **422-426**; roll-path clamp **411-414**; canonical `JackpotUpdate(jackpotPool)` at **257**.

**What & why.** Two owner-only correctness defects in one function:
1. **Wrong event value.** `boostJackpot` does `jackpotPool += amount; emit JackpotUpdate(amount);` — it emits the *increment*, whereas every other `JackpotUpdate` (e.g. line 257) emits the full `jackpotPool` total. Off-chain indexers reconstructing pool size from `JackpotUpdate` record a wrong value after a boost (e.g. pool 490,000 + boost 100,000 emits "100,000").
2. **Over-cap truncation.** `boostJackpot` does **not** clamp against `maxJackpotPool`, but `processJackpotWin` unconditionally clamps `jackpotPool` down to `maxJackpotPool` on every roll (411-414). So any boost pushing the pool above the cap is silently truncated on the very next non-jackpot roll — the boosted excess is lost unless a jackpot is won on the immediately following roll. An owner boosting beyond the cap will not achieve a lasting larger jackpot.

**Verifier split.** Two lenses confirm both facts as real Informational defects (reachable, wrong indexer state, lost boost). The third rates NotAVuln because events aren't consumed on-chain, the bad event self-corrects on the next roll (which re-emits the true total at 257), the clamp is intentional design, and `jackpotPool` is a pure accounting value — real $LAZY lives in LGS, so nothing is lost from the treasury. We adopt **Informational**: a real telemetry/UX inconsistency with no fund-loss or attacker path (`onlyOwner`).

**Fix.** Emit `JackpotUpdate(jackpotPool)` (the new total) from `boostJackpot` for consistency, and either clamp the boost to `maxJackpotPool` at boost time or raise `maxJackpotPool` in the same call so the intended marquee jackpot persists.

---

## 4. Caveats

- This report is the product of an **automated multi-agent adversarial review**, not a manual line-by-line engagement. It surfaces reasoning about reachability, mitigations, and impact, but agents can miss context a human auditor would catch.
- It is **not a substitute for a formal audit**. Before mainnet exposure (or before increasing LGS balances that back these payouts), commission an independent human audit and run **fuzzing / invariant testing** — particularly around: the revert-unwinds-`history` state machine (TL-01), payout-parameter bounds and aggregate caps (TL-03), and the external-call failure modes on the win path (TL-04).
- Severities are calibrated to the stated trust model (`systemWallet` and the LGS/PRNG/LDR/LSH context are trusted). Several Low findings become materially worse under the **explicitly stated preconditions** — signer hot-key compromise (TL-03), signer key reuse across live deployments (TL-02), or a dependency outage (TL-04) — and should be read with those blast radii in mind rather than as "trusted, therefore ignorable."
- Findings that were unanimously refuted by all three verifier lenses were excluded and are not represented here.