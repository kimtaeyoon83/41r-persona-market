#[test_only]
module rpm::campaign_tests;

use rpm::campaign::{Self, Campaign, CampaignOwnerCap};
use sui::test_scenario as ts;
use sui::coin::{Self, Coin};
use sui::sui::SUI;
use sui::clock;
use std::string;

const REQUESTER: address = @0xA;
const PERSONA: address = @0xB;

#[test]
fun create_settle_close_flow() {
    let mut sc = ts::begin(REQUESTER);
    let clock = clock::create_for_testing(sc.ctx());

    // Create campaign with a 1000-unit reward escrow.
    {
        let reward = coin::mint_for_testing<SUI>(1000, sc.ctx());
        campaign::create_and_keep(
            reward,
            string::utf8(b"https://example.com"),
            string::utf8(b"{}"),
            &clock,
            sc.ctx(),
        );
    };

    // Settle 600 to the persona owner.
    sc.next_tx(REQUESTER);
    {
        let mut camp = sc.take_shared<Campaign<SUI>>();
        let cap = sc.take_from_sender<CampaignOwnerCap>();
        assert!(campaign::pool_value(&camp) == 1000);
        campaign::settle(&mut camp, &cap, PERSONA, 600, sc.ctx());
        assert!(campaign::pool_value(&camp) == 400);
        sc.return_to_sender(cap);
        ts::return_shared(camp);
    };

    // The persona received exactly a 600 coin.
    sc.next_tx(PERSONA);
    {
        let c = sc.take_from_sender<Coin<SUI>>();
        assert!(coin::value(&c) == 600);
        coin::burn_for_testing(c);
    };

    // Close refunds the remaining 400 to the requester and marks closed.
    sc.next_tx(REQUESTER);
    {
        let mut camp = sc.take_shared<Campaign<SUI>>();
        let cap = sc.take_from_sender<CampaignOwnerCap>();
        campaign::close(&mut camp, &cap, sc.ctx());
        assert!(campaign::pool_value(&camp) == 0);
        assert!(!campaign::is_open(&camp));
        sc.return_to_sender(cap);
        ts::return_shared(camp);
    };

    // Requester got the 400 refund.
    sc.next_tx(REQUESTER);
    {
        let c = sc.take_from_sender<Coin<SUI>>();
        assert!(coin::value(&c) == 400);
        coin::burn_for_testing(c);
    };

    clock::destroy_for_testing(clock);
    sc.end();
}

#[test]
#[expected_failure(abort_code = campaign::EInsufficientPool)]
fun settle_over_pool_aborts() {
    let mut sc = ts::begin(REQUESTER);
    let clock = clock::create_for_testing(sc.ctx());
    {
        let reward = coin::mint_for_testing<SUI>(100, sc.ctx());
        campaign::create_and_keep(reward, string::utf8(b"u"), string::utf8(b"{}"), &clock, sc.ctx());
    };
    sc.next_tx(REQUESTER);
    {
        let mut camp = sc.take_shared<Campaign<SUI>>();
        let cap = sc.take_from_sender<CampaignOwnerCap>();
        // Over-draw: only 100 in pool.
        campaign::settle(&mut camp, &cap, PERSONA, 9999, sc.ctx());
        sc.return_to_sender(cap);
        ts::return_shared(camp);
    };
    clock::destroy_for_testing(clock);
    sc.end();
}
