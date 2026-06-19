#[test_only]
module rpm::persona_tests;

use rpm::persona;
use std::string;
use sui::clock;

#[test]
fun mint_starts_empty() {
    let mut ctx = tx_context::dummy();
    let clock = clock::create_for_testing(&mut ctx);

    let p = persona::mint(&clock, &mut ctx);
    assert!(persona::version(&p) == 0);
    assert!(persona::memwal_count(&p) == 0);
    assert!(!persona::has_adapter(&p));
    assert!(!persona::has_ontology(&p));

    persona::burn(p);
    clock::destroy_for_testing(clock);
}

#[test]
fun mutations_append_and_bump_version() {
    let mut ctx = tx_context::dummy();
    let clock = clock::create_for_testing(&mut ctx);
    let mut p = persona::mint(&clock, &mut ctx);

    persona::add_memwal_ref(&mut p, string::utf8(b"blob-1"), &clock);
    persona::add_memwal_ref(&mut p, string::utf8(b"blob-2"), &clock);
    assert!(persona::memwal_count(&p) == 2);
    assert!(persona::version(&p) == 2);

    persona::set_ontology_ref(&mut p, string::utf8(b"node-1"), &clock);
    assert!(persona::has_ontology(&p));
    assert!(persona::version(&p) == 3);

    persona::set_adapter_ref(
        &mut p,
        string::utf8(b"adapter-blob"),
        string::utf8(b"base-v1"),
        &clock,
    );
    assert!(persona::has_adapter(&p));
    assert!(persona::version(&p) == 4);

    persona::add_domain_tag(&mut p, string::utf8(b"defi"), &clock);
    assert!(persona::domain_tag_count(&p) == 1);
    assert!(persona::version(&p) == 5);

    persona::burn(p);
    clock::destroy_for_testing(clock);
}

#[test]
fun adapter_ref_is_replaceable() {
    let mut ctx = tx_context::dummy();
    let clock = clock::create_for_testing(&mut ctx);
    let mut p = persona::mint(&clock, &mut ctx);

    persona::set_adapter_ref(&mut p, string::utf8(b"v1"), string::utf8(b"base-v1"), &clock);
    // Re-training replaces the adapter ref in place (still one adapter).
    persona::set_adapter_ref(&mut p, string::utf8(b"v2"), string::utf8(b"base-v2"), &clock);
    assert!(persona::has_adapter(&p));
    assert!(persona::version(&p) == 2);

    persona::burn(p);
    clock::destroy_for_testing(clock);
}
