#[test_only]
module knit_demo::collateral_vault_tests;

use knit::knit;
use knit_demo::collateral_vault::{Self, CollateralVault};
use sui::test_scenario as ts;

const LADDER: u8 = 2;
const THREE_DUSDC: u64 = 3_000_000;

#[test]
fun pledge_then_release_roundtrip() {
    let user = @0xA;
    let mut scenario = ts::begin(user);

    collateral_vault::new_vault(ts::ctx(&mut scenario));

    ts::next_tx(&mut scenario, user);
    {
        let mut vault = ts::take_shared<CollateralVault>(&scenario);

        // An external module takes a Knit note by value and inspects it.
        let note = knit::new_note_for_testing(LADDER, THREE_DUSDC, ts::ctx(&mut scenario));
        let receipt = collateral_vault::pledge(&mut vault, note, ts::ctx(&mut scenario));

        assert!(collateral_vault::pledged_count(&vault) == 1, 0);
        assert!(collateral_vault::total_max_payout(&vault) == THREE_DUSDC, 1);

        // The note is handed back intact — full composability roundtrip.
        let note_back = collateral_vault::release(&mut vault, receipt);
        assert!(collateral_vault::pledged_count(&vault) == 0, 2);
        assert!(collateral_vault::total_max_payout(&vault) == 0, 3);

        transfer::public_transfer(note_back, user);
        ts::return_shared(vault);
    };

    ts::end(scenario);
}
