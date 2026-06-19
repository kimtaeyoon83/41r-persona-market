#[test_only]
module rpm::mutual_tests;

use rpm::mutual::{Self, MutualCampaign, MutualOwnerCap};
use sui::test_scenario as ts;
use sui::coin::{Self, Coin};
use sui::sui::SUI;
use sui::clock;
use std::string;

const REQUESTER: address = @0xA;
const PERSONA: address = @0xB;

fun str(b: vector<u8>): string::String { string::utf8(b) }

#[test]
fun full_forward_flow_settles_persona() {
    let mut sc = ts::begin(REQUESTER);
    let clock = clock::create_for_testing(sc.ctx());

    // Company seals asset + locks 1000 reward.
    {
        let reward = coin::mint_for_testing<SUI>(1000, sc.ctx());
        let cap = mutual::create(
            reward, str(b"asset-blob"), str(b"hash"), str(b"matched"), true, &clock, sc.ctx(),
        );
        transfer::public_transfer(cap, REQUESTER);
    };

    // Persona opts in with a 200 stake.
    sc.next_tx(PERSONA);
    {
        let mut mc = sc.take_shared<MutualCampaign>();
        let stake = coin::mint_for_testing<SUI>(200, sc.ctx());
        mutual::opt_in(&mut mc, stake, sc.ctx());
        assert!(mutual::state(&mc) == 2);
        assert!(mutual::stake_value(&mc) == 200);
        ts::return_shared(mc);
    };

    // Asset revealed (off-chain Seal), then evidence committed.
    sc.next_tx(PERSONA);
    {
        let mut mc = sc.take_shared<MutualCampaign>();
        mutual::mark_asset_revealed(&mut mc, sc.ctx());
        mutual::commit_evidence(&mut mc, str(b"ev-blob"), str(b"paid-only"), sc.ctx());
        assert!(mutual::state(&mc) == 4);
        ts::return_shared(mc);
    };

    // Company reveals evidence + settles.
    sc.next_tx(REQUESTER);
    {
        let mut mc = sc.take_shared<MutualCampaign>();
        let cap = sc.take_from_sender<MutualOwnerCap>();
        mutual::reveal_evidence(&mut mc, &cap);
        mutual::settle(&mut mc, &cap, sc.ctx());
        assert!(mutual::is_settled(&mc));
        assert!(mutual::reward_value(&mc) == 0);
        assert!(mutual::stake_value(&mc) == 0);
        sc.return_to_sender(cap);
        ts::return_shared(mc);
    };

    // Persona received reward (1000) + stake back (200) = 1200.
    sc.next_tx(PERSONA);
    {
        let c1 = sc.take_from_sender<Coin<SUI>>();
        let c2 = sc.take_from_sender<Coin<SUI>>();
        assert!(coin::value(&c1) + coin::value(&c2) == 1200);
        coin::burn_for_testing(c1);
        coin::burn_for_testing(c2);
    };

    clock::destroy_for_testing(clock);
    sc.end();
}

#[test]
fun slash_sends_reward_and_stake_to_requester() {
    let mut sc = ts::begin(REQUESTER);
    let clock = clock::create_for_testing(sc.ctx());
    {
        let reward = coin::mint_for_testing<SUI>(1000, sc.ctx());
        let cap = mutual::create(reward, str(b"a"), str(b"h"), str(b"m"), true, &clock, sc.ctx());
        transfer::public_transfer(cap, REQUESTER);
    };
    sc.next_tx(PERSONA);
    {
        let mut mc = sc.take_shared<MutualCampaign>();
        let stake = coin::mint_for_testing<SUI>(200, sc.ctx());
        mutual::opt_in(&mut mc, stake, sc.ctx());
        ts::return_shared(mc);
    };
    // Requester slashes (persona didn't cooperate / leaked).
    sc.next_tx(REQUESTER);
    {
        let mut mc = sc.take_shared<MutualCampaign>();
        let cap = sc.take_from_sender<MutualOwnerCap>();
        mutual::slash(&mut mc, &cap, sc.ctx());
        assert!(mutual::is_aborted(&mc));
        sc.return_to_sender(cap);
        ts::return_shared(mc);
    };
    // Requester got reward + stake = 1200.
    sc.next_tx(REQUESTER);
    {
        let c1 = sc.take_from_sender<Coin<SUI>>();
        let c2 = sc.take_from_sender<Coin<SUI>>();
        assert!(coin::value(&c1) + coin::value(&c2) == 1200);
        coin::burn_for_testing(c1);
        coin::burn_for_testing(c2);
    };
    clock::destroy_for_testing(clock);
    sc.end();
}

#[test]
#[expected_failure(abort_code = mutual::EWrongState)]
fun out_of_order_commit_aborts() {
    let mut sc = ts::begin(REQUESTER);
    let clock = clock::create_for_testing(sc.ctx());
    {
        let reward = coin::mint_for_testing<SUI>(10, sc.ctx());
        let cap = mutual::create(reward, str(b"a"), str(b"h"), str(b"m"), false, &clock, sc.ctx());
        transfer::public_transfer(cap, REQUESTER);
    };
    sc.next_tx(PERSONA);
    {
        let mut mc = sc.take_shared<MutualCampaign>();
        let stake = coin::mint_for_testing<SUI>(0, sc.ctx());
        mutual::opt_in(&mut mc, stake, sc.ctx());
        // Skip mark_asset_revealed → commit_evidence must abort (EWrongState).
        mutual::commit_evidence(&mut mc, str(b"ev"), str(b"p"), sc.ctx());
        ts::return_shared(mc);
    };
    clock::destroy_for_testing(clock);
    sc.end();
}
