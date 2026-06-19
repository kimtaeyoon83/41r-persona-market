/// RPM Seal access policy (design doc v0.4 §4.4, §4.5).
///
/// Seal decryption is gated by a `seal_approve*` function: the key-server
/// committee releases decryption shares only if this function does NOT
/// abort when dry-run (devInspect) with the encryption `id` (and the
/// SessionKey's address as sender). This is the on-chain half of
/// "결제한 주소만 복호화" — without a central intermediary.
module rpm::seal_policy;

use rpm::campaign::{Self, Campaign};

const ENoAccess: u64 = 1;

/// ⚠️ TEST-ONLY OPEN POLICY — approves everything. Kept for round-trip
/// smoke tests; never gate sensitive data with this.
entry fun seal_approve(id: vector<u8>) {
    let _ = id;
}

/// §4.5 SealedEvidence gate — the REAL policy. Decryptable ONLY by the
/// campaign requester (the paying company), and ONLY for ciphertext whose
/// `id` is namespaced to THIS campaign (id must start with the campaign's
/// object id bytes). The namespace prefix stops a requester from
/// decrypting a different campaign's evidence by passing another Campaign.
entry fun seal_approve_evidence<T>(
    id: vector<u8>,
    campaign: &Campaign<T>,
    ctx: &TxContext,
) {
    assert!(is_prefix(object::id_bytes(campaign), id), ENoAccess);
    assert!(campaign::requester(campaign) == ctx.sender(), ENoAccess);
}

/// True when `prefix` is a leading subsequence of `full`.
fun is_prefix(prefix: vector<u8>, full: vector<u8>): bool {
    if (prefix.length() > full.length()) return false;
    let mut i = 0;
    while (i < prefix.length()) {
        if (prefix[i] != full[i]) return false;
        i = i + 1;
    };
    true
}

#[test]
fun is_prefix_works() {
    assert!(is_prefix(vector[1, 2], vector[1, 2, 3]));
    assert!(!is_prefix(vector[1, 9], vector[1, 2, 3]));
    assert!(!is_prefix(vector[1, 2, 3, 4], vector[1, 2, 3]));
    assert!(is_prefix(vector[], vector[1]));
}
