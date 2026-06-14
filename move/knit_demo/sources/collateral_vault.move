/// Composability demo: an INDEPENDENT package that consumes Knit's `NoteReceipt`.
///
/// On DeepBook Predict, positions are rows in a shared `PredictManager` table —
/// you can't hold, transfer, or hand them to another contract. Knit wraps a bundle
/// of positions into one `NoteReceipt` object (`has key, store`). This vault proves
/// the payoff: a separate module can take a note by value, read its public state,
/// custody it, and hand it back — i.e. use a structured note as composable collateral.
/// On mainnet day-one this is the seam where margin / structured wrappers plug in.
module knit_demo::collateral_vault;

use knit::knit::{Self, NoteReceipt};
use sui::event;
use sui::object_table::{Self, ObjectTable};

const E_WRONG_VAULT: u64 = 0;

public struct CollateralVault has key {
    id: UID,
    notes: ObjectTable<ID, NoteReceipt>,
    total_max_payout: u64,
}

/// Claim check returned to the pledger; required to withdraw the note back.
public struct CollateralReceipt has key, store {
    id: UID,
    vault_id: ID,
    note_id: ID,
    pledged_max_payout: u64,
}

public struct NotePledged has copy, drop {
    vault_id: ID,
    note_id: ID,
    owner: address,
    max_payout: u64,
    template: u8,
}

public struct NoteReleased has copy, drop {
    vault_id: ID,
    note_id: ID,
}

public fun new_vault(ctx: &mut TxContext) {
    transfer::share_object(CollateralVault {
        id: object::new(ctx),
        notes: object_table::new(ctx),
        total_max_payout: 0,
    });
}

/// Take a Knit note as collateral. Reads the note's public getters (proving an
/// external module can inspect it) and custodies the object in the vault.
public fun pledge(
    vault: &mut CollateralVault,
    note: NoteReceipt,
    ctx: &mut TxContext,
): CollateralReceipt {
    let note_id = object::id(&note);
    let max_payout = knit::note_max_payout(&note);
    let template = knit::note_template(&note);

    vault.total_max_payout = vault.total_max_payout + max_payout;
    object_table::add(&mut vault.notes, note_id, note);

    event::emit(NotePledged {
        vault_id: object::id(vault),
        note_id,
        owner: ctx.sender(),
        max_payout,
        template,
    });

    CollateralReceipt {
        id: object::new(ctx),
        vault_id: object::id(vault),
        note_id,
        pledged_max_payout: max_payout,
    }
}

/// Burn the claim check and return the custodied note to the caller.
public fun release(vault: &mut CollateralVault, receipt: CollateralReceipt): NoteReceipt {
    let CollateralReceipt { id, vault_id, note_id, pledged_max_payout } = receipt;
    assert!(vault_id == object::id(vault), E_WRONG_VAULT);
    object::delete(id);

    let note = object_table::remove(&mut vault.notes, note_id);
    vault.total_max_payout = vault.total_max_payout - pledged_max_payout;

    event::emit(NoteReleased { vault_id: object::id(vault), note_id });
    note
}

public fun total_max_payout(vault: &CollateralVault): u64 {
    vault.total_max_payout
}

public fun pledged_count(vault: &CollateralVault): u64 {
    object_table::length(&vault.notes)
}
