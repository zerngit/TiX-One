module tix_one::ticket;

use std::string::{Self, String};
use one::display;
use one::package::{Self, Publisher};
use one::coin::{Self, Coin};
use one::transfer_policy::{Self, TransferPolicy};

// --- Errors ---
const EPriceTooHigh: u64 = 1;
const EIncorrectAmount: u64 = 2;
const TICKET_PRICE: u64 = 100_000_000; // 1 OCT with 9 decimals

// --- The Ticket Asset ---
public struct Ticket has key, store {
    id: UID,
    artist: String,
    event_name: String,
    seat: String,
    original_price: u64,
}

public struct PriceCapRule has drop {}
public struct TICKET has drop {}
public struct AdminCap has key { id: UID }

fun init(otw: TICKET, ctx: &mut TxContext) {
    let publisher = package::claim(otw, ctx);
    let keys = vector[string::utf8(b"name"), string::utf8(b"image_url")];
    let values = vector[
        string::utf8(b"TiX-One: {artist}"),
        string::utf8(b"https://api.dicebear.com/7.x/identicon/svg?seed={id}")
    ];

    let mut display = display::new_with_fields<Ticket>(&publisher, keys, values, ctx);
    display::update_version(&mut display);

    transfer::transfer(AdminCap { id: object::new(ctx) }, ctx.sender());
    transfer::public_transfer(display, ctx.sender());
    transfer::public_transfer(publisher, ctx.sender());
}

// --- 1. SETTING THE LAW ---
#[allow(lint(share_owned, self_transfer))]
public fun create_transfer_policy(
    _: &AdminCap, 
    pub: &Publisher, 
    ctx: &mut TxContext
) {
    let (mut policy, policy_cap) = transfer_policy::new<Ticket>(pub, ctx);
    
    transfer_policy::add_rule<Ticket, PriceCapRule, bool>(
        PriceCapRule {}, 
        &mut policy, 
        &policy_cap, 
        true
    );
    
    transfer::public_share_object(policy);
    transfer::public_transfer(policy_cap, ctx.sender());
}

// --- 2. THE PRIMARY SALE (Generic Coin) ---
// By adding <COIN>, this function now works with USDC, OCT, or anything else!
#[allow(lint(self_transfer))]
public fun buy_ticket<COIN>(
    payment: Coin<COIN>,
    artist: String,
    event_name: String,
    seat: String,
    price: u64,
    ctx: &mut TxContext
) {
    assert!(coin::value(&payment) == price, EIncorrectAmount);
    transfer::public_transfer(payment, @0xe551904e859d3358ca7813622f9ada529ddecd24801a5f6bddb4a521fcb9c940);

    let ticket = Ticket {
        id: object::new(ctx),
        artist,
        event_name,
        seat,
        original_price: price,
    };
    transfer::public_transfer(ticket, ctx.sender());
}

// --- 3. ENTRY FUNCTION FOR OCT PAYMENTS (Fixed Price: 1 OCT) ---
// Uses &mut Coin so the frontend only needs a single moveCall (simplest PTB)
#[allow(lint(self_transfer, public_entry))]
public entry fun buy_ticket_oct(
    payment: &mut Coin<0x2::oct::OCT>,
    ctx: &mut TxContext
) {
    assert!(coin::value(payment) >= TICKET_PRICE, EIncorrectAmount);
    let paid = coin::split(payment, TICKET_PRICE, ctx);
    transfer::public_transfer(paid, @0xe551904e859d3358ca7813622f9ada529ddecd24801a5f6bddb4a521fcb9c940);

    let ticket = Ticket {
        id: object::new(ctx),
        artist: string::utf8(b"TiX-One Artist"),
        event_name: string::utf8(b"TiX-One Event"),
        seat: string::utf8(b"General Admission"),
        original_price: TICKET_PRICE,
    };
    transfer::public_transfer(ticket, ctx.sender());
}

// --- 4. THE RESALE ENFORCER ---
public fun verify_resale(
    _policy: &mut TransferPolicy<Ticket>,
    request: &mut transfer_policy::TransferRequest<Ticket>,
    ticket: &Ticket
) {
    let paid_amount = transfer_policy::paid(request);
    assert!(paid_amount <= ticket.original_price, EPriceTooHigh);
    transfer_policy::add_receipt(PriceCapRule {}, request);
}