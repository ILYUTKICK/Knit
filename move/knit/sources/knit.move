module knit::knit;

use deepbook_predict::{
    market_key,
    oracle::{Self, OracleSVI},
    predict::{Self, Predict},
    predict_manager::PredictManager,
    range_key,
};
use std::vector;
use sui::{
    balance::{Self, Balance},
    clock::Clock,
    coin::{Self, Coin},
    event,
};

const E_NOT_ADMIN: u64 = 0;
const E_FEE_TOO_HIGH: u64 = 1;
const E_ORACLE_NOT_ACTIVE: u64 = 2;
const E_BAD_TEMPLATE_PARAMS: u64 = 3;
const E_MANAGER_MISMATCH: u64 = 4;
const E_ORACLE_MISMATCH: u64 = 5;
const E_ALREADY_REDEEMED: u64 = 6;
const E_NOT_MANAGER_OWNER: u64 = 7;

const TEMPLATE_RANGE: u8 = 0;
const TEMPLATE_BREAKOUT: u8 = 1;
const TEMPLATE_LADDER: u8 = 2;

const LEG_BINARY: u8 = 0;
const LEG_RANGE: u8 = 1;

const STATUS_OPEN: u8 = 0;
const STATUS_REDEEMED: u8 = 1;

const MAX_FEE_BPS: u64 = 1_000;
const BPS_DENOMINATOR: u64 = 10_000;

public struct NoteRegistry<phantom Quote> has key {
    id: UID,
    admin: address,
    fee_bps: u64,
    fee_vault: Balance<Quote>,
}

public struct NoteReceipt has key, store {
    id: UID,
    manager_id: ID,
    oracle_id: ID,
    expiry: u64,
    template: u8,
    legs: vector<Leg>,
    cost_paid: u64,
    max_payout: u64,
    created_at_ms: u64,
    status: u8,
}

public struct Leg has copy, drop, store {
    kind: u8,
    is_up: bool,
    strike: u64,
    lower_strike: u64,
    higher_strike: u64,
    quantity: u64,
}

public struct NoteCreated has copy, drop, store {
    registry_id: ID,
    note_id: ID,
    manager_id: ID,
    oracle_id: ID,
    owner: address,
    template: u8,
    cost_paid: u64,
    max_payout: u64,
}

public struct NoteRedeemed has copy, drop, store {
    registry_id: ID,
    note_id: ID,
    manager_id: ID,
    oracle_id: ID,
    owner: address,
    payout: u64,
}

public fun create_registry<Quote>(fee_bps: u64, ctx: &mut TxContext) {
    assert!(fee_bps <= MAX_FEE_BPS, E_FEE_TOO_HIGH);

    let registry = NoteRegistry<Quote> {
        id: object::new(ctx),
        admin: ctx.sender(),
        fee_bps,
        fee_vault: balance::zero<Quote>(),
    };

    transfer::share_object(registry);
}

public fun set_fee_bps<Quote>(
    registry: &mut NoteRegistry<Quote>,
    fee_bps: u64,
    ctx: &TxContext,
) {
    assert_admin(registry, ctx);
    assert!(fee_bps <= MAX_FEE_BPS, E_FEE_TOO_HIGH);
    registry.fee_bps = fee_bps;
}

public fun withdraw_fees<Quote>(
    registry: &mut NoteRegistry<Quote>,
    amount: u64,
    ctx: &mut TxContext,
) {
    assert_admin(registry, ctx);
    let coin = coin::take(&mut registry.fee_vault, amount, ctx);
    transfer::public_transfer(coin, ctx.sender());
}

public fun create_range_note<Quote>(
    registry: &mut NoteRegistry<Quote>,
    predict: &mut Predict,
    manager: &mut PredictManager,
    oracle: &OracleSVI,
    payment: Coin<Quote>,
    lower_strike: u64,
    higher_strike: u64,
    quantity: u64,
    clock: &Clock,
    ctx: &mut TxContext,
): NoteReceipt {
    assert!(lower_strike < higher_strike, E_BAD_TEMPLATE_PARAMS);
    assert!(quantity > 0, E_BAD_TEMPLATE_PARAMS);

    let mut legs = vector[];
    legs.push_back(Leg {
        kind: LEG_RANGE,
        is_up: false,
        strike: 0,
        lower_strike,
        higher_strike,
        quantity,
    });

    create_note_from_legs(
        registry,
        predict,
        manager,
        oracle,
        payment,
        TEMPLATE_RANGE,
        legs,
        quantity,
        clock,
        ctx,
    )
}

public fun create_breakout_note<Quote>(
    registry: &mut NoteRegistry<Quote>,
    predict: &mut Predict,
    manager: &mut PredictManager,
    oracle: &OracleSVI,
    payment: Coin<Quote>,
    lower_strike: u64,
    higher_strike: u64,
    quantity: u64,
    clock: &Clock,
    ctx: &mut TxContext,
): NoteReceipt {
    assert!(lower_strike < higher_strike, E_BAD_TEMPLATE_PARAMS);
    assert!(quantity > 0, E_BAD_TEMPLATE_PARAMS);

    let mut legs = vector[];
    legs.push_back(binary_leg(false, lower_strike, quantity));
    legs.push_back(binary_leg(true, higher_strike, quantity));

    create_note_from_legs(
        registry,
        predict,
        manager,
        oracle,
        payment,
        TEMPLATE_BREAKOUT,
        legs,
        quantity,
        clock,
        ctx,
    )
}

public fun create_ladder_note<Quote>(
    registry: &mut NoteRegistry<Quote>,
    predict: &mut Predict,
    manager: &mut PredictManager,
    oracle: &OracleSVI,
    payment: Coin<Quote>,
    strike_1: u64,
    strike_2: u64,
    strike_3: u64,
    quantity: u64,
    clock: &Clock,
    ctx: &mut TxContext,
): NoteReceipt {
    assert!(strike_1 < strike_2 && strike_2 < strike_3, E_BAD_TEMPLATE_PARAMS);
    assert!(quantity > 0, E_BAD_TEMPLATE_PARAMS);

    let mut legs = vector[];
    legs.push_back(binary_leg(true, strike_1, quantity));
    legs.push_back(binary_leg(true, strike_2, quantity));
    legs.push_back(binary_leg(true, strike_3, quantity));

    create_note_from_legs(
        registry,
        predict,
        manager,
        oracle,
        payment,
        TEMPLATE_LADDER,
        legs,
        quantity * 3,
        clock,
        ctx,
    )
}

public fun redeem_note<Quote>(
    registry: &NoteRegistry<Quote>,
    predict: &mut Predict,
    manager: &mut PredictManager,
    oracle: &OracleSVI,
    receipt: NoteReceipt,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert!(receipt.status == STATUS_OPEN, E_ALREADY_REDEEMED);
    assert!(object::id(manager) == receipt.manager_id, E_MANAGER_MISMATCH);
    assert!(oracle::id(oracle) == receipt.oracle_id, E_ORACLE_MISMATCH);
    assert!(oracle::expiry(oracle) == receipt.expiry, E_ORACLE_MISMATCH);
    assert!(manager.owner() == ctx.sender(), E_NOT_MANAGER_OWNER);

    let balance_before = manager.balance<Quote>();
    let mut i = 0;
    while (i < vector::length(&receipt.legs)) {
        let leg = *vector::borrow(&receipt.legs, i);
        redeem_leg<Quote>(predict, manager, oracle, leg, clock, ctx);
        i = i + 1;
    };

    let balance_after = manager.balance<Quote>();
    let payout = balance_after - balance_before;
    let note_id = object::id(&receipt);
    let manager_id = receipt.manager_id;
    let oracle_id = receipt.oracle_id;

    destroy_receipt(receipt, STATUS_REDEEMED);

    event::emit(NoteRedeemed {
        registry_id: object::id(registry),
        note_id,
        manager_id,
        oracle_id,
        owner: ctx.sender(),
        payout,
    });

    if (payout > 0) {
        let payout_coin = manager.withdraw<Quote>(payout, ctx);
        transfer::public_transfer(payout_coin, ctx.sender());
    };
}

public fun fee_bps<Quote>(registry: &NoteRegistry<Quote>): u64 {
    registry.fee_bps
}

public fun fee_balance<Quote>(registry: &NoteRegistry<Quote>): u64 {
    registry.fee_vault.value()
}

public fun note_manager_id(receipt: &NoteReceipt): ID {
    receipt.manager_id
}

public fun note_oracle_id(receipt: &NoteReceipt): ID {
    receipt.oracle_id
}

public fun note_template(receipt: &NoteReceipt): u8 {
    receipt.template
}

public fun note_cost_paid(receipt: &NoteReceipt): u64 {
    receipt.cost_paid
}

public fun note_max_payout(receipt: &NoteReceipt): u64 {
    receipt.max_payout
}

public fun note_status(receipt: &NoteReceipt): u8 {
    receipt.status
}

fun create_note_from_legs<Quote>(
    registry: &mut NoteRegistry<Quote>,
    predict: &mut Predict,
    manager: &mut PredictManager,
    oracle: &OracleSVI,
    mut payment: Coin<Quote>,
    template: u8,
    legs: vector<Leg>,
    max_payout: u64,
    clock: &Clock,
    ctx: &mut TxContext,
): NoteReceipt {
    assert!(oracle::is_active(oracle), E_ORACLE_NOT_ACTIVE);
    assert!(manager.owner() == ctx.sender(), E_NOT_MANAGER_OWNER);

    let input_value = payment.value();
    let fee = input_value * registry.fee_bps / BPS_DENOMINATOR;
    if (fee > 0) {
        let fee_coin = payment.split(fee, ctx);
        registry.fee_vault.join(fee_coin.into_balance());
    };

    let balance_before = manager.balance<Quote>();
    manager.deposit(payment, ctx);

    let mut i = 0;
    while (i < vector::length(&legs)) {
        let leg = *vector::borrow(&legs, i);
        mint_leg<Quote>(predict, manager, oracle, leg, clock, ctx);
        i = i + 1;
    };

    let balance_after = manager.balance<Quote>();
    let refund = balance_after - balance_before;
    if (refund > 0) {
        let refund_coin = manager.withdraw<Quote>(refund, ctx);
        transfer::public_transfer(refund_coin, ctx.sender());
    };

    let receipt = NoteReceipt {
        id: object::new(ctx),
        manager_id: object::id(manager),
        oracle_id: oracle::id(oracle),
        expiry: oracle::expiry(oracle),
        template,
        legs,
        cost_paid: input_value - refund,
        max_payout,
        created_at_ms: clock.timestamp_ms(),
        status: STATUS_OPEN,
    };

    event::emit(NoteCreated {
        registry_id: object::id(registry),
        note_id: object::id(&receipt),
        manager_id: object::id(manager),
        oracle_id: oracle::id(oracle),
        owner: ctx.sender(),
        template,
        cost_paid: receipt.cost_paid,
        max_payout,
    });

    receipt
}

fun mint_leg<Quote>(
    predict: &mut Predict,
    manager: &mut PredictManager,
    oracle: &OracleSVI,
    leg: Leg,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    let oracle_id = oracle::id(oracle);
    let expiry = oracle::expiry(oracle);

    if (leg.kind == LEG_RANGE) {
        let key = range_key::new(oracle_id, expiry, leg.lower_strike, leg.higher_strike);
        predict::mint_range<Quote>(predict, manager, oracle, key, leg.quantity, clock, ctx);
    } else {
        let key = market_key::new(oracle_id, expiry, leg.strike, leg.is_up);
        predict::mint<Quote>(predict, manager, oracle, key, leg.quantity, clock, ctx);
    };
}

fun redeem_leg<Quote>(
    predict: &mut Predict,
    manager: &mut PredictManager,
    oracle: &OracleSVI,
    leg: Leg,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    let oracle_id = oracle::id(oracle);
    let expiry = oracle::expiry(oracle);

    if (leg.kind == LEG_RANGE) {
        let key = range_key::new(oracle_id, expiry, leg.lower_strike, leg.higher_strike);
        predict::redeem_range<Quote>(predict, manager, oracle, key, leg.quantity, clock, ctx);
    } else {
        let key = market_key::new(oracle_id, expiry, leg.strike, leg.is_up);
        predict::redeem<Quote>(predict, manager, oracle, key, leg.quantity, clock, ctx);
    };
}

fun binary_leg(is_up: bool, strike: u64, quantity: u64): Leg {
    Leg {
        kind: LEG_BINARY,
        is_up,
        strike,
        lower_strike: 0,
        higher_strike: 0,
        quantity,
    }
}

fun assert_admin<Quote>(registry: &NoteRegistry<Quote>, ctx: &TxContext) {
    assert!(registry.admin == ctx.sender(), E_NOT_ADMIN);
}

fun destroy_receipt(receipt: NoteReceipt, status: u8) {
    let NoteReceipt {
        id,
        manager_id: _,
        oracle_id: _,
        expiry: _,
        template: _,
        legs: _,
        cost_paid: _,
        max_payout: _,
        created_at_ms: _,
        status: old_status,
    } = receipt;
    assert!(old_status != status, E_ALREADY_REDEEMED);
    object::delete(id);
}

#[test_only]
/// Build a NoteReceipt without touching the live Predict protocol, so external
/// packages can unit-test composability (pledging/holding/inspecting a note).
public fun new_note_for_testing(template: u8, max_payout: u64, ctx: &mut TxContext): NoteReceipt {
    NoteReceipt {
        id: object::new(ctx),
        manager_id: object::id_from_address(@0x0),
        oracle_id: object::id_from_address(@0x0),
        expiry: 0,
        template,
        legs: vector[],
        cost_paid: 0,
        max_payout,
        created_at_ms: 0,
        status: STATUS_OPEN,
    }
}
