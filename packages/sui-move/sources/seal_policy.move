/// RPM Seal access policy (design doc v0.4 §4.4).
///
/// Seal decryption is gated by a `seal_approve*` function: the key-server
/// committee releases decryption shares only if this function does NOT
/// abort when dry-run with the encryption `id`. This is the on-chain
/// half of "결제한 주소만 복호화" — without a central intermediary.
///
/// ⚠️ TEST-ONLY OPEN POLICY: `seal_approve` below approves everything.
/// It exists to prove the encrypt→decrypt round-trip end-to-end on
/// testnet. The PRODUCTION policy must gate on real conditions (e.g.
/// "caller paid into campaign escrow" / "persona owner"), mirroring the
/// §4.5 SealedAsset/SealedEvidence seal_policy predicates. Replace before
/// any sensitive data is gated.
module rpm::seal_policy;

/// Open approval — never aborts, so any identity is decryptable. The
/// `id` is the Seal encryption identity (unused here). Seal evaluates
/// this via devInspect; it must be callable (entry) and must not abort.
entry fun seal_approve(id: vector<u8>) {
    let _ = id;
}
