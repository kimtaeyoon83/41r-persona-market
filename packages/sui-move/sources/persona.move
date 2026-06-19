/// RPM Persona — the user-owned root object (design doc v0.4 §4.1).
///
/// A Persona is a Sui *owned object*: sovereignty and portability come
/// from the address that holds it, not from a central DB. Heavy data
/// (behavior evidence, ontology, LoRA adapter) lives in Walrus; this
/// object carries only the verifiable *references* (MemWal, §4.2) plus
/// ownership metadata.
///
/// Access control = Sui's ownership model. Mutators take the object by
/// `&mut`/by-value, so only a tx the owner signed can reach them — there
/// is no explicit `owner` field or assert. Walrus immutability means a
/// committed ref can't be forged or altered; Seal (off-chain) gates who
/// may *decrypt* the referenced blob.
module rpm::persona;

use std::string::String;
use sui::clock::Clock;

/// Stage 3 reference to the persona's LoRA adapter (§4.1 `adapter_ref`).
/// "Frozen base + this adapter = this persona." Ownership of the adapter
/// is a *policy choice* (§8), enforced by keeping the ref on the
/// user-owned object; the weights themselves live in Walrus, Seal-gated.
public struct AdapterRef has store, drop, copy {
    /// Walrus blob ID of the trained adapter weights.
    blob_id: String,
    /// The frozen base model version the adapter was trained against
    /// (§11 — adapters are base-version-bound).
    base_model_version: String,
}

/// User-owned persona. `key` only (no `store`) so it can't be wrapped
/// into another object and silently re-owned — every transfer is an
/// explicit, owner-signed move.
public struct Persona has key {
    id: UID,
    /// Walrus blob IDs — behavior data + accumulated session evidence (§4.2).
    memwal_refs: vector<String>,
    /// Stage 2 ontology node reference.
    ontology_ref: Option<String>,
    /// Stage 3 LoRA adapter reference.
    adapter_ref: Option<AdapterRef>,
    /// Monotonic version, bumped on every mutation.
    version: u64,
    created_at_ms: u64,
    updated_at_ms: u64,
    /// Free-form domain tags (e.g. b"defi", b"ecommerce").
    domain_tags: vector<String>,
}

/// Mint a fresh persona (owned by whoever the caller transfers it to).
public fun mint(clock: &Clock, ctx: &mut TxContext): Persona {
    let now = clock.timestamp_ms();
    Persona {
        id: object::new(ctx),
        memwal_refs: vector[],
        ontology_ref: option::none(),
        adapter_ref: option::none(),
        version: 0,
        created_at_ms: now,
        updated_at_ms: now,
        domain_tags: vector[],
    }
}

/// Mint and transfer to the sender in one call.
public fun mint_to_sender(clock: &Clock, ctx: &mut TxContext) {
    transfer::transfer(mint(clock, ctx), ctx.sender());
}

/// Append a Walrus blob ref (a new session's evidence). Owner-gated by
/// Sui: the object only arrives here in a tx its owner signed.
public fun add_memwal_ref(self: &mut Persona, blob_id: String, clock: &Clock) {
    self.memwal_refs.push_back(blob_id);
    self.touch(clock);
}

/// Set the Stage 2 ontology node reference.
public fun set_ontology_ref(self: &mut Persona, node: String, clock: &Clock) {
    self.ontology_ref.swap_or_fill(node);
    self.touch(clock);
}

/// Set / replace the Stage 3 LoRA adapter reference.
public fun set_adapter_ref(
    self: &mut Persona,
    blob_id: String,
    base_model_version: String,
    clock: &Clock,
) {
    self.adapter_ref.swap_or_fill(AdapterRef { blob_id, base_model_version });
    self.touch(clock);
}

/// Add a domain tag.
public fun add_domain_tag(self: &mut Persona, tag: String, clock: &Clock) {
    self.domain_tags.push_back(tag);
    self.touch(clock);
}

/// Transfer ownership (sovereignty — §4.1 "전송은 owner 서명 필요").
public fun transfer_to(self: Persona, recipient: address) {
    transfer::transfer(self, recipient);
}

/// Permanently destroy the persona (right to delete). The referenced
/// Walrus blobs are crypto-shredded separately by revoking Seal keys
/// (§12) — deleting this object drops the on-chain references.
public fun burn(self: Persona) {
    let Persona {
        id,
        memwal_refs: _,
        ontology_ref: _,
        adapter_ref: _,
        version: _,
        created_at_ms: _,
        updated_at_ms: _,
        domain_tags: _,
    } = self;
    id.delete();
}

fun touch(self: &mut Persona, clock: &Clock) {
    self.version = self.version + 1;
    self.updated_at_ms = clock.timestamp_ms();
}

// ─── Read accessors ──────────────────────────────────────────────────
public fun version(self: &Persona): u64 { self.version }

public fun memwal_count(self: &Persona): u64 { self.memwal_refs.length() }

public fun has_adapter(self: &Persona): bool { self.adapter_ref.is_some() }

public fun has_ontology(self: &Persona): bool { self.ontology_ref.is_some() }

public fun domain_tag_count(self: &Persona): u64 { self.domain_tags.length() }
