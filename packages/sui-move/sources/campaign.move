/// RPM Campaign + Escrow (design doc v0.4 §4.3).
///
/// A Campaign is a *shared* object so the requester and any matched
/// persona owner can interact with it in the same lifecycle. The reward
/// is locked as an on-chain `Balance<SUI>` escrow at creation and only
/// leaves via `settle` (pay a verified persona owner) or `close` (refund
/// the remainder to the requester).
///
/// Settlement is gated by a `CampaignOwnerCap` minted to the requester.
/// In the MVP that capability stands in for the verification anchor
/// (§6) — a later slice replaces "cap holder decides" with "settle only
/// against a verified session proof". The escrow mechanics don't change
/// when that lands; only who is allowed to call `settle`.
module rpm::campaign;

use std::string::String;
use sui::balance::Balance;
use sui::coin::{Self, Coin};
use sui::clock::Clock;
use sui::sui::SUI;

const EWrongCampaign: u64 = 1;
const EInsufficientPool: u64 = 2;
const ENotOpen: u64 = 3;

const STATUS_OPEN: u8 = 0;
const STATUS_CLOSED: u8 = 1;

/// Shared campaign holding the reward escrow.
public struct Campaign has key {
    id: UID,
    requester: address,
    /// Target URL / task spec (§4.3).
    target: String,
    /// Persona match criteria (serialized selector, §4.3).
    persona_criteria: String,
    /// Locked reward — escrow. Drains only via settle / close.
    reward_pool: Balance<SUI>,
    status: u8,
    created_at_ms: u64,
}

/// Capability authorizing settle/close on exactly one campaign. Held by
/// the requester (later: the verification anchor). `store` so it can be
/// transferred/custodied.
public struct CampaignOwnerCap has key, store {
    id: UID,
    campaign_id: ID,
}

/// Create a campaign, lock `reward` as escrow, share the campaign, and
/// return the owner capability to the caller.
public fun create(
    reward: Coin<SUI>,
    target: String,
    persona_criteria: String,
    clock: &Clock,
    ctx: &mut TxContext,
): CampaignOwnerCap {
    let campaign = Campaign {
        id: object::new(ctx),
        requester: ctx.sender(),
        target,
        persona_criteria,
        reward_pool: reward.into_balance(),
        status: STATUS_OPEN,
        created_at_ms: clock.timestamp_ms(),
    };
    let cap = CampaignOwnerCap {
        id: object::new(ctx),
        campaign_id: object::id(&campaign),
    };
    transfer::share_object(campaign);
    cap
}

/// Create + transfer the cap to the sender (entry-friendly). The
/// composable variant `create` returns the cap for PTB use.
#[allow(lint(self_transfer))]
public fun create_and_keep(
    reward: Coin<SUI>,
    target: String,
    persona_criteria: String,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    let cap = create(reward, target, persona_criteria, clock, ctx);
    transfer::public_transfer(cap, ctx.sender());
}

/// Pay `amount` from the escrow to a verified persona owner. Cap-gated.
public fun settle(
    campaign: &mut Campaign,
    cap: &CampaignOwnerCap,
    recipient: address,
    amount: u64,
    ctx: &mut TxContext,
) {
    assert_cap(campaign, cap);
    assert!(campaign.status == STATUS_OPEN, ENotOpen);
    assert!(campaign.reward_pool.value() >= amount, EInsufficientPool);
    let paid = coin::take(&mut campaign.reward_pool, amount, ctx);
    transfer::public_transfer(paid, recipient);
}

/// Close the campaign: refund any remaining escrow to the requester and
/// mark it closed. Cap-gated.
public fun close(
    campaign: &mut Campaign,
    cap: &CampaignOwnerCap,
    ctx: &mut TxContext,
) {
    assert_cap(campaign, cap);
    assert!(campaign.status == STATUS_OPEN, ENotOpen);
    let remaining = campaign.reward_pool.value();
    if (remaining > 0) {
        let refund = coin::take(&mut campaign.reward_pool, remaining, ctx);
        transfer::public_transfer(refund, campaign.requester);
    };
    campaign.status = STATUS_CLOSED;
}

fun assert_cap(campaign: &Campaign, cap: &CampaignOwnerCap) {
    assert!(cap.campaign_id == object::id(campaign), EWrongCampaign);
}

// ─── Read accessors ──────────────────────────────────────────────────
public fun pool_value(campaign: &Campaign): u64 { campaign.reward_pool.value() }

public fun status(campaign: &Campaign): u8 { campaign.status }

public fun requester(campaign: &Campaign): address { campaign.requester }

public fun is_open(campaign: &Campaign): bool { campaign.status == STATUS_OPEN }
