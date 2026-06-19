/// RPM Mutual-Sealed Campaign (design doc v0.4 §4.5).
///
/// Two-way sealed exchange: the company seals a pre-release asset
/// (SealedAsset, company→persona) and the persona seals its session
/// evidence (SealedEvidence, persona→company). Neither side reveals
/// without the other progressing — an atomic-swap-*style* flow that,
/// because true atomicity is impossible across the asymmetric reveal,
/// is enforced as an escrow-backed state machine plus a slashable stake
/// (§4.5.3 — "비대칭 시점 교환에 atomic이 불가능할 때의 올바른 대체물").
///
/// On-chain this object tracks STATE + the Walrus/Seal *references* and
/// holds the reward escrow + persona stake. The actual decryption gating
/// (who may open which blob) is Seal, off-chain (§4.4). Copy-leak of a
/// revealed asset is NOT preventable here — see §4.5.3 (sandbox_only +
/// stake slashing + TEE are the mitigations; T1 limits this to low/med
/// sensitivity assets).
///
/// State machine (§4.5.2):
///   ASSET_SEALED → PERSONA_OPTED_IN → ASSET_REVEALED →
///   EVIDENCE_COMMITTED → EVIDENCE_REVEALED → SETTLED
/// with SLASH/ABORT reachable from any post-opt-in pre-settle state.
module rpm::mutual;

use std::string::String;
use sui::balance::{Self, Balance};
use sui::coin::{Self, Coin};
use sui::clock::Clock;
use sui::sui::SUI;

const EWrongState: u64 = 1;
const ENotPersona: u64 = 2;
const EWrongCampaign: u64 = 3;
const ENotSlashable: u64 = 4;

const STATE_ASSET_SEALED: u8 = 1;
const STATE_PERSONA_OPTED_IN: u8 = 2;
const STATE_ASSET_REVEALED: u8 = 3;
const STATE_EVIDENCE_COMMITTED: u8 = 4;
const STATE_EVIDENCE_REVEALED: u8 = 5;
const STATE_SETTLED: u8 = 6;
const STATE_ABORTED: u8 = 7;

/// Shared mutual-sealed campaign.
public struct MutualCampaign has key {
    id: UID,
    requester: address,
    /// The persona owner who opted in (None until opt-in).
    persona: Option<address>,
    // ── SealedAsset (company → persona, §4.5.1 A) ──
    asset_blob_ref: String,
    asset_hash: String,
    asset_seal_policy: String,
    /// §4.5.3 — decrypt only inside the platform sandbox (T1+).
    sandbox_only: bool,
    // ── SealedEvidence (persona → company, §4.5.1 B) ──
    evidence_blob_ref: Option<String>,
    evidence_seal_policy: Option<String>,
    // ── Escrow + bond ──
    reward_pool: Balance<SUI>,
    stake_pool: Balance<SUI>,
    exchange_state: u8,
    created_at_ms: u64,
}

/// Capability authorizing the company-side transitions (reveal_evidence,
/// settle, slash). Held by the requester / verification anchor.
public struct MutualOwnerCap has key, store {
    id: UID,
    campaign_id: ID,
}

/// Create: company seals the asset + locks the reward. Initial state is
/// ASSET_SEALED (the CREATED→ASSET_SEALED transition happens at mint).
public fun create(
    reward: Coin<SUI>,
    asset_blob_ref: String,
    asset_hash: String,
    asset_seal_policy: String,
    sandbox_only: bool,
    clock: &Clock,
    ctx: &mut TxContext,
): MutualOwnerCap {
    let mc = MutualCampaign {
        id: object::new(ctx),
        requester: ctx.sender(),
        persona: option::none(),
        asset_blob_ref,
        asset_hash,
        asset_seal_policy,
        sandbox_only,
        evidence_blob_ref: option::none(),
        evidence_seal_policy: option::none(),
        reward_pool: reward.into_balance(),
        stake_pool: balance::zero(),
        exchange_state: STATE_ASSET_SEALED,
        created_at_ms: clock.timestamp_ms(),
    };
    let cap = MutualOwnerCap { id: object::new(ctx), campaign_id: object::id(&mc) };
    transfer::share_object(mc);
    cap
}

/// Persona opts in, optionally posting a stake bond. ASSET_SEALED →
/// PERSONA_OPTED_IN. The caller becomes the bound persona.
public fun opt_in(mc: &mut MutualCampaign, stake: Coin<SUI>, ctx: &mut TxContext) {
    assert!(mc.exchange_state == STATE_ASSET_SEALED, EWrongState);
    mc.persona.fill(ctx.sender());
    mc.stake_pool.join(stake.into_balance());
    mc.exchange_state = STATE_PERSONA_OPTED_IN;
}

/// Advance once the persona has (off-chain, via Seal in the sandbox)
/// gained decrypt access to the asset. PERSONA_OPTED_IN → ASSET_REVEALED.
public fun mark_asset_revealed(mc: &mut MutualCampaign, ctx: &TxContext) {
    assert!(mc.exchange_state == STATE_PERSONA_OPTED_IN, EWrongState);
    assert_persona(mc, ctx);
    mc.exchange_state = STATE_ASSET_REVEALED;
}

/// Persona commits its sealed session evidence. ASSET_REVEALED →
/// EVIDENCE_COMMITTED.
public fun commit_evidence(
    mc: &mut MutualCampaign,
    evidence_blob_ref: String,
    evidence_seal_policy: String,
    ctx: &TxContext,
) {
    assert!(mc.exchange_state == STATE_ASSET_REVEALED, EWrongState);
    assert_persona(mc, ctx);
    mc.evidence_blob_ref.fill(evidence_blob_ref);
    mc.evidence_seal_policy.fill(evidence_seal_policy);
    mc.exchange_state = STATE_EVIDENCE_COMMITTED;
}

/// Company gains decrypt access to the evidence after verification.
/// EVIDENCE_COMMITTED → EVIDENCE_REVEALED. Cap-gated.
public fun reveal_evidence(mc: &mut MutualCampaign, cap: &MutualOwnerCap) {
    assert_cap(mc, cap);
    assert!(mc.exchange_state == STATE_EVIDENCE_COMMITTED, EWrongState);
    mc.exchange_state = STATE_EVIDENCE_REVEALED;
}

/// Settle: pay the reward to the persona and return its stake.
/// EVIDENCE_REVEALED → SETTLED. Cap-gated.
public fun settle(mc: &mut MutualCampaign, cap: &MutualOwnerCap, ctx: &mut TxContext) {
    assert_cap(mc, cap);
    assert!(mc.exchange_state == STATE_EVIDENCE_REVEALED, EWrongState);
    let persona = *mc.persona.borrow();
    pay_all(&mut mc.reward_pool, persona, ctx);
    pay_all(&mut mc.stake_pool, persona, ctx);
    mc.exchange_state = STATE_SETTLED;
}

/// Slash: on non-cooperation / leak, the persona's stake and the reward
/// both go back to the requester. Reachable from any post-opt-in,
/// pre-settle state. Cap-gated.
public fun slash(mc: &mut MutualCampaign, cap: &MutualOwnerCap, ctx: &mut TxContext) {
    assert_cap(mc, cap);
    let s = mc.exchange_state;
    assert!(
        s == STATE_PERSONA_OPTED_IN
            || s == STATE_ASSET_REVEALED
            || s == STATE_EVIDENCE_COMMITTED,
        ENotSlashable,
    );
    pay_all(&mut mc.stake_pool, mc.requester, ctx);
    pay_all(&mut mc.reward_pool, mc.requester, ctx);
    mc.exchange_state = STATE_ABORTED;
}

fun pay_all(pool: &mut Balance<SUI>, recipient: address, ctx: &mut TxContext) {
    let amount = pool.value();
    if (amount > 0) {
        let c = coin::from_balance(pool.split(amount), ctx);
        transfer::public_transfer(c, recipient);
    };
}

fun assert_cap(mc: &MutualCampaign, cap: &MutualOwnerCap) {
    assert!(cap.campaign_id == object::id(mc), EWrongCampaign);
}

fun assert_persona(mc: &MutualCampaign, ctx: &TxContext) {
    assert!(mc.persona.contains(&ctx.sender()), ENotPersona);
}

// ─── Read accessors ──────────────────────────────────────────────────
public fun state(mc: &MutualCampaign): u8 { mc.exchange_state }

public fun reward_value(mc: &MutualCampaign): u64 { mc.reward_pool.value() }

public fun stake_value(mc: &MutualCampaign): u64 { mc.stake_pool.value() }

public fun is_settled(mc: &MutualCampaign): bool { mc.exchange_state == STATE_SETTLED }

public fun is_aborted(mc: &MutualCampaign): bool { mc.exchange_state == STATE_ABORTED }
