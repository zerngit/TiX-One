#[test_only]
module tix_one::tix_one_tests;

use tix_one::ticket::{Self, Ticket};
use one::test_scenario;

#[test]
fun test_mint_ticket() {
    let admin = @0xAD;
    let mut scenario = test_scenario::begin(admin);
    
    // 1. Run the mint function
    {
        ticket::mint_ticket(b"Seat A1", test_scenario::ctx(&mut scenario));
    };

    // 2. Check if the Ticket object now exists for the admin
    test_scenario::next_tx(&mut scenario, admin);
    {
        let ticket = test_scenario::take_from_sender<Ticket>(&scenario);
        // If we can 'take' it, it exists!
        test_scenario::return_to_sender(&scenario, ticket);
    };
    
    test_scenario::end(scenario);
}
