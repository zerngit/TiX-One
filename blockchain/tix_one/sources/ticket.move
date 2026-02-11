module tix_one::ticket;

// 1. We only need to import String. Everything else is automatic in 2024!
use std::string::{Self, String};

// 2. Define the Ticket
public struct Ticket has key, store {
    id: UID,
    seat: String,
    price: u64,
}

// 3. The Mint Function
// This line tells the compiler: "I know what I'm doing, let me send the object."
#[allow(lint(self_transfer))]
public fun mint_ticket(seat_bytes: vector<u8>, ctx: &mut TxContext) {
    let ticket = Ticket {
        id: object::new(ctx),
        seat: string::utf8(seat_bytes),
        price: 100
    };

    // 'transfer' and 'object' are already there!
    transfer::public_transfer(ticket, ctx.sender());
}
