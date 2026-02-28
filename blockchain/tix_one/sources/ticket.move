module tix_one::ticket;

use std::string::{Self, String};
use one::display;
use one::package::{Self, Publisher};
use one::coin::{Self, Coin};
use one::balance::{Self, Balance};
use one::transfer_policy::{Self, TransferPolicy};
use one::clock::{Self, Clock};
use one::kiosk::{Self, Kiosk};
use one::object;
use one::ed25519;
use one::bcs;

// --- Errors ---
const EPriceTooHigh: u64 = 0;
const EIncorrectAmount: u64 = 1;
const EAlreadyScanned: u64 = 2;
const ETicketExpired: u64 = 3;
const ESoldOut: u64 = 7;
const EInvalidSignature: u64 = 8;
const ENotInWaitlist: u64 = 9;
const EWaitlistEmpty: u64 = 10;
const EWrongConcert: u64 = 11;
const EZeroQuantity: u64 = 12;

const TICKET_PRICE: u64 = 100_000_000; // 0.1 OCT with 9 decimals

// =========================================================
// --- Concert Registry (Shared Object, one per event) ---
// =========================================================
public struct Concert has key {
    id: UID,
    artist: String,
    event_name: String,
    max_supply: u64,
    tickets_sold: u64,
}

// --- The Ticket Asset ---
public struct Ticket has key, store {
    id: UID,
    artist: String,
    event_name: String,
    seat: String,
    original_price: u64,
    is_scanned: bool,
    expires_at: u64,  // Unix timestamp in milliseconds
    allow_admin_scan: bool,  // Allow admin to scan without owner signature
}

// --- Check-In Record (Created by Admin when scanning) ---
public struct CheckInRecord has key, store {
    id: UID,
    ticket_id: ID,
    ticket_owner: address,
    checked_in_at: u64,
    checked_in_by: address,
}

public struct PriceCapRule has drop {}
public struct TICKET has drop {}
public struct ListingRegistry has key, store { id: UID }

// =========================================================
// --- On-Chain Escrow Waitlist ---
// =========================================================

/// A single position in the waitlist queue, holding
/// the buyer's address and their escrowed OCT funds.
public struct WaitlistEntry has store {
    buyer: address,
    escrow_balance: Balance<0x2::oct::OCT>,
}

/// Shared object — one per concert.
/// `face_value` is the required deposit (= original ticket price).
/// `queue` is FIFO: index 0 is the next-to-be-served buyer.
public struct Waitlist has key {
    id: UID,
    concert_id: ID,
    face_value: u64,
    queue: vector<WaitlistEntry>,
}

// --- Events ---
public struct WaitlistJoined has copy, drop {
    waitlist_id: ID,
    concert_id: ID,
    buyer: address,
    amount: u64,
    position: u64,   // 1-based queue position
}

public struct WaitlistLeft has copy, drop {
    waitlist_id: ID,
    concert_id: ID,
    buyer: address,
}

public struct WaitlistFulfilled has copy, drop {
    waitlist_id: ID,
    concert_id: ID,
    buyer: address,
    seller: address,
    amount: u64,
}

// --- Custom Event for Global Marketplace Discovery ---
public struct TicketListedEvent has copy, drop {
    ticket_id: ID,
    price: u64,
    seller: address,
    event_name: String,
    artist: String,
}

// =========================================================
// --- Backend Verifier (Shared Object, holds Ed25519 pubkey) ---
// =========================================================
/// Stores the backend's Ed25519 public key. Used to verify that a
/// "Verified Fan" purchase was approved by the TiX-One backend.
public struct BackendVerifier has key {
    id: UID,
    public_key: vector<u8>,
}

public struct AdminCap has key, store { id: UID }

fun init(otw: TICKET, ctx: &mut TxContext) {
    let publisher = package::claim(otw, ctx);
    
    // Define display fields for explorer visualization
    let keys = vector[
        string::utf8(b"name"),
        string::utf8(b"description"),
        string::utf8(b"image_url"),
        string::utf8(b"link"),
    ];
    
    let values = vector[
        string::utf8(b"TiX-One Ticket: {event_name}"),
        string::utf8(b"Official TiX-One digital ticket for {artist}. Securely verified on-chain."),
        string::utf8(b"https://api.dicebear.com/7.x/bottts/svg?seed={id}&backgroundColor=b6e3f4"),
        string::utf8(b"https://tix-one.io/ticket/{id}"),
    ];

    let mut display = display::new_with_fields<Ticket>(&publisher, keys, values, ctx);
    display::update_version(&mut display);

    // Transfer objects to admin (ctx.sender)
    transfer::transfer(AdminCap { id: object::new(ctx) }, ctx.sender());
    transfer::public_transfer(display, ctx.sender());
    transfer::public_transfer(publisher, ctx.sender());
    transfer::share_object(ListingRegistry { id: object::new(ctx) });
}

// =========================================================
// --- 1. CONCERT REGISTRY: Create a per-event supply cap ---
// =========================================================
/// Admin-only: create a shared Concert object that governs how many
/// tickets can ever be minted for this specific event.
public fun create_concert(
    _: &AdminCap,
    artist: String,
    event_name: String,
    max_supply: u64,
    ctx: &mut TxContext,
) {
    let concert = Concert {
        id: object::new(ctx),
        artist,
        event_name,
        max_supply,
        tickets_sold: 0,
    };
    // Share so buyers (and the frontend PTB) can mutably reference it.
    transfer::share_object(concert);
}

// =========================================================
// --- WAITLIST: Admin creates one per concert ---
// =========================================================
/// Admin-only: create a shared Waitlist for a concert.
/// `face_value` must match the ticket price so escrow amounts are exact.
public fun create_waitlist(
    _: &AdminCap,
    concert: &Concert,
    face_value: u64,
    ctx: &mut TxContext,
) {
    transfer::share_object(Waitlist {
        id: object::new(ctx),
        concert_id: object::id(concert),
        face_value,
        queue: vector::empty(),
    });
}

// =========================================================
// --- BackendVerifier: Admin functions ---
// =========================================================
/// Admin-only: create and share the BackendVerifier with the backend's Ed25519 public key.
public fun initialize_verifier(
    _: &AdminCap,
    public_key: vector<u8>,
    ctx: &mut TxContext,
) {
    transfer::share_object(BackendVerifier {
        id: object::new(ctx),
        public_key,
    });
}

/// Admin-only: rotate the backend's public key (e.g. after key compromise).
public fun update_verifier_key(
    _: &AdminCap,
    verifier: &mut BackendVerifier,
    new_public_key: vector<u8>,
) {
    verifier.public_key = new_public_key;
}

// --- Convenience read-only accessors ---
public fun concert_artist(c: &Concert): String { c.artist }
public fun concert_event_name(c: &Concert): String { c.event_name }
public fun concert_max_supply(c: &Concert): u64 { c.max_supply }
public fun concert_tickets_sold(c: &Concert): u64 { c.tickets_sold }

// =========================================================
// --- 2. SETTING THE LAW (Transfer Policy) ---
// =========================================================
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

// =========================================================
// --- 3. PRIMARY SALE: Generic Coin (with Concert cap) ---
// =========================================================
#[allow(lint(self_transfer))]
public fun buy_ticket<COIN>(
    concert: &mut Concert,
    payment: Coin<COIN>,
    seat: String,
    price: u64,
    quantity: u64,
    clock: &Clock,
    ctx: &mut TxContext
) {
    assert!(quantity > 0, EZeroQuantity);
    assert!(concert.tickets_sold + quantity <= concert.max_supply, ESoldOut);
    assert!(coin::value(&payment) == price * quantity, EIncorrectAmount);

    transfer::public_transfer(payment, @0xe551904e859d3358ca7813622f9ada529ddecd24801a5f6bddb4a521fcb9c940);

    // Ticket valid for 30 days (30 * 24 * 60 * 60 * 1000 milliseconds)
    let expiration = clock::timestamp_ms(clock) + 2_592_000_000;
    let buyer = ctx.sender();

    let mut i = 0u64;
    while (i < quantity) {
        let ticket = Ticket {
            id: object::new(ctx),
            artist: concert.artist,
            event_name: concert.event_name,
            seat,
            original_price: price,
            is_scanned: false,
            expires_at: expiration,
            allow_admin_scan: true,
        };
        transfer::public_transfer(ticket, buyer);
        i = i + 1;
    };

    concert.tickets_sold = concert.tickets_sold + quantity;
}

// =========================================================
// --- 4. PRIMARY SALE: OCT fixed price (with Concert cap) ---
// =========================================================
#[allow(lint(self_transfer))]
public fun buy_ticket_oct(
    concert: &mut Concert,
    mut payment: Coin<0x2::oct::OCT>,
    quantity: u64,
    clock: &Clock,
    ctx: &mut TxContext
) {
    assert!(quantity > 0, EZeroQuantity);
    assert!(concert.tickets_sold + quantity <= concert.max_supply, ESoldOut);
    let total = TICKET_PRICE * quantity;
    assert!(coin::value(&payment) >= total, EIncorrectAmount);

    let ticket_payment = coin::split(&mut payment, total, ctx);
    transfer::public_transfer(ticket_payment, @0xe551904e859d3358ca7813622f9ada529ddecd24801a5f6bddb4a521fcb9c940);

    // Return change to sender
    transfer::public_transfer(payment, ctx.sender());

    let expiration = clock::timestamp_ms(clock) + 2_592_000_000;
    let buyer = ctx.sender();

    let mut i = 0u64;
    while (i < quantity) {
        let ticket = Ticket {
            id: object::new(ctx),
            artist: concert.artist,
            event_name: concert.event_name,
            seat: string::utf8(b"General Admission"),
            original_price: TICKET_PRICE,
            is_scanned: false,
            expires_at: expiration,
            allow_admin_scan: true,
        };
        transfer::public_transfer(ticket, buyer);
        i = i + 1;
    };

    concert.tickets_sold = concert.tickets_sold + quantity;
}

// =========================================================
// --- 5. PRIMARY SALE: OCT variable price (with Concert cap) ---
// =========================================================
#[allow(lint(self_transfer))]
public fun buy_ticket_oct_at_price(
    concert: &mut Concert,
    mut payment: Coin<0x2::oct::OCT>,
    seat: String,
    price: u64,
    quantity: u64,
    clock: &Clock,
    ctx: &mut TxContext
) {
    assert!(quantity > 0, EZeroQuantity);
    assert!(concert.tickets_sold + quantity <= concert.max_supply, ESoldOut);
    let total = price * quantity;
    assert!(coin::value(&payment) >= total, EIncorrectAmount);

    let ticket_payment = coin::split(&mut payment, total, ctx);
    transfer::public_transfer(ticket_payment, @0xe551904e859d3358ca7813622f9ada529ddecd24801a5f6bddb4a521fcb9c940);

    // Return change to sender
    transfer::public_transfer(payment, ctx.sender());

    let expiration = clock::timestamp_ms(clock) + 2_592_000_000;
    let buyer = ctx.sender();

    let mut i = 0u64;
    while (i < quantity) {
        let ticket = Ticket {
            id: object::new(ctx),
            artist: concert.artist,
            event_name: concert.event_name,
            seat,
            original_price: price,
            is_scanned: false,
            expires_at: expiration,
            allow_admin_scan: true,
        };
        transfer::public_transfer(ticket, buyer);
        i = i + 1;
    };

    concert.tickets_sold = concert.tickets_sold + quantity;
}

// =========================================================
// --- 6. PRIMARY SALE: Verified Fan (Ed25519 signature required) ---
// =========================================================
/// Same as buy_ticket_oct_at_price but the backend must have signed
/// a message proving this buyer passed the Spotify fan check.
/// Message = bcs(buyer_address) || bcs(concert_id)  (64 bytes total)
#[allow(lint(self_transfer))]
public fun buy_verified_fan_ticket(
    concert: &mut Concert,
    verifier: &BackendVerifier,
    signature: vector<u8>,
    mut payment: Coin<0x2::oct::OCT>,
    seat: String,
    price: u64,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    // Build 64-byte message = buyer_address_bytes || concert_object_id_bytes
    let buyer = ctx.sender();
    let mut msg = bcs::to_bytes(&buyer);                          // 32 bytes
    let cid = object::id(concert);
    let id_bytes = bcs::to_bytes(&cid);                           // 32 bytes
    msg.append(id_bytes);

    // Verify the backend's Ed25519 signature over that message
    assert!(
        ed25519::ed25519_verify(&signature, &verifier.public_key, &msg),
        EInvalidSignature
    );

    // Normal supply-cap + payment checks
    assert!(concert.tickets_sold < concert.max_supply, ESoldOut);
    assert!(coin::value(&payment) >= price, EIncorrectAmount);

    let ticket_payment = coin::split(&mut payment, price, ctx);
    transfer::public_transfer(ticket_payment, @0xe551904e859d3358ca7813622f9ada529ddecd24801a5f6bddb4a521fcb9c940);
    transfer::public_transfer(payment, ctx.sender());

    concert.tickets_sold = concert.tickets_sold + 1;

    let expiration = clock::timestamp_ms(clock) + 2_592_000_000;
    let ticket = Ticket {
        id: object::new(ctx),
        artist: concert.artist,
        event_name: concert.event_name,
        seat,
        original_price: price,
        is_scanned: false,
        expires_at: expiration,
        allow_admin_scan: true,
    };
    transfer::public_transfer(ticket, ctx.sender());
}

// =========================================================
// --- 7. RESALE ENFORCER (price-cap only, no private approvals) ---
// =========================================================
/// Enforces that the resale price never exceeds the original face value.
/// Called inside the kiosk transfer-policy resolution flow.
public fun verify_resale(
    _policy: &mut TransferPolicy<Ticket>,
    request: &mut transfer_policy::TransferRequest<Ticket>,
    _registry: &mut ListingRegistry,
    ticket: &Ticket
) {
    let paid_amount = transfer_policy::paid(request);
    assert!(paid_amount <= ticket.original_price, EPriceTooHigh);
    transfer_policy::add_receipt(PriceCapRule {}, request);
}

// =========================================================
// --- 8. EMIT TICKET EVENT (Global Marketplace Discovery) ---
// =========================================================
public fun emit_listing_event(
    ticket: &Ticket,
    price: u64,
    ctx: &mut TxContext
) {
    one::event::emit(TicketListedEvent {
        ticket_id: object::id(ticket),
        price,
        seller: ctx.sender(),
        event_name: ticket.event_name,
        artist: ticket.artist,
    });
}

// =========================================================
// --- 9. PUBLIC SAFE LISTING (Global Marketplace) ---
// =========================================================
/// Lists a ticket on the seller's kiosk at face value (or below).
/// Emits a marketplace discovery event so the frontend can index it.
public fun safe_list_ticket(
    kiosk: &mut Kiosk,
    cap: &one::kiosk::KioskOwnerCap,
    ticket: Ticket,
    price: u64,
    _registry: &mut ListingRegistry,
    ctx: &mut TxContext
) {
    assert!(price <= ticket.original_price, EPriceTooHigh);
    emit_listing_event(&ticket, price, ctx);
    one::kiosk::place_and_list(kiosk, cap, ticket, price);
}

// =========================================================
// --- 10. ON-CHAIN ESCROW WAITLIST ---
// =========================================================

/// Join the waitlist for a sold-out concert.
/// The caller must send exactly `waitlist.face_value` OCT as escrow.
/// Their position in the queue (1-based) is emitted on-chain.
public fun join_waitlist(
    waitlist: &mut Waitlist,
    payment: Coin<0x2::oct::OCT>,
    ctx: &mut TxContext,
) {
    assert!(coin::value(&payment) == waitlist.face_value, EIncorrectAmount);

    let buyer = ctx.sender();
    let escrow_balance = coin::into_balance(payment);

    waitlist.queue.push_back(WaitlistEntry { buyer, escrow_balance });

    let position = waitlist.queue.length(); // 1-based after push
    one::event::emit(WaitlistJoined {
        waitlist_id: object::id(waitlist),
        concert_id: waitlist.concert_id,
        buyer,
        amount: waitlist.face_value,
        position,
    });
}

/// Leave the waitlist and receive your escrowed OCT back.
/// Searches the queue linearly — O(n). Aborts if the caller is not in the queue.
public fun leave_waitlist(
    waitlist: &mut Waitlist,
    ctx: &mut TxContext,
) {
    let caller = ctx.sender();
    let len = waitlist.queue.length();
    let mut i = 0u64;
    let mut found = false;

    while (i < len && !found) {
        if (waitlist.queue.borrow(i).buyer == caller) {
            found = true;
        } else {
            i = i + 1;
        };
    };

    assert!(found, ENotInWaitlist);

    let WaitlistEntry { buyer, escrow_balance } = waitlist.queue.remove(i);
    let refund = coin::from_balance(escrow_balance, ctx);
    transfer::public_transfer(refund, buyer);

    one::event::emit(WaitlistLeft {
        waitlist_id: object::id(waitlist),
        concert_id: waitlist.concert_id,
        buyer: caller,
    });
}

/// Fulfill the first waitlist order (FIFO).
/// The caller (seller/returner) provides their Ticket.
/// The ticket goes to the waiting buyer; the escrowed OCT goes to the seller.
/// Price-cap is enforced: the ticket's original_price must not exceed the waitlist face_value.
#[allow(lint(self_transfer))]
public fun fulfill_waitlist_order(
    waitlist: &mut Waitlist,
    ticket: Ticket,
    concert: &Concert,
    ctx: &mut TxContext,
) {
    // Ensure this waitlist belongs to the correct concert
    assert!(object::id(concert) == waitlist.concert_id, EWrongConcert);
    // Ensure the ticket is not overpriced relative to the waitlist face value (PriceCapRule)
    assert!(ticket.original_price <= waitlist.face_value, EPriceTooHigh);
    // Ensure someone is actually waiting
    assert!(!waitlist.queue.is_empty(), EWaitlistEmpty);

    let seller = ctx.sender();
    let WaitlistEntry { buyer, escrow_balance } = waitlist.queue.remove(0);
    let amount = balance::value(&escrow_balance);

    // Pay the seller the face-value OCT from escrow
    let payment = coin::from_balance(escrow_balance, ctx);
    transfer::public_transfer(payment, seller);

    // Deliver the ticket to the first person in queue
    transfer::public_transfer(ticket, buyer);

    one::event::emit(WaitlistFulfilled {
        waitlist_id: object::id(waitlist),
        concert_id: waitlist.concert_id,
        buyer,
        seller,
        amount,
    });
}

// =========================================================
// --- 11. THE GATEKEEPER: VERIFY AND CHECK-IN ---
// =========================================================
#[allow(lint(public_entry))]
public entry fun verify_and_check_in(
    _admin: &AdminCap,
    ticket_id: ID,
    ticket_owner: address,
    clock: &Clock,
    ctx: &mut TxContext
) {
    let record = CheckInRecord {
        id: object::new(ctx),
        ticket_id: ticket_id,
        ticket_owner: ticket_owner,
        checked_in_at: clock::timestamp_ms(clock),
        checked_in_by: ctx.sender(),
    };
    transfer::public_transfer(record, ctx.sender());
}

// =========================================================
// --- 12. ADMIN: Reset ticket scan for testing ---
// =========================================================
#[allow(lint(public_entry))]
public entry fun reset_ticket_scan(
    _: &AdminCap,
    ticket: &mut Ticket,
    _ctx: &mut TxContext
) {
    ticket.is_scanned = false;
}