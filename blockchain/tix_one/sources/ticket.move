module tix_one::ticket;

use std::string::{Self, String};
use one::display;
use one::package::{Self, Publisher};
use one::coin::{Self, Coin};
use one::transfer_policy::{Self, TransferPolicy};
use one::clock::{Self, Clock};
use one::kiosk::{Self, Kiosk};
use one::dynamic_field;
use one::object;

// --- Errors ---
const EPriceTooHigh: u64 = 1;
const EIncorrectAmount: u64 = 2;
const EAlreadyScanned: u64 = 3;
const ETicketExpired: u64 = 4;
const EListingNotApproved: u64 = 5;
const EListingPriceMismatch: u64 = 6;
const EListingSourceMismatch: u64 = 7;
const TICKET_PRICE: u64 = 100_000_000; // 0.1 OCT with 9 decimals

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

public struct ListingApproval has store, drop {
    kiosk_id: ID,
    approved_price: u64,
}

// --- Custom Event for Global Marketplace Discovery ---
public struct TicketListedEvent has copy, drop {
    ticket_id: ID,
    price: u64,
    seller: address,
    event_name: String,
    artist: String,
}
public struct AdminCap has key, store { id: UID }  // Make it store so it can be used in PTBs

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

// --- 3. THE PRIMARY SALE (Generic Coin) ---
// By adding <COIN>, this function now works with USDC, OCT, or anything else!
#[allow(lint(self_transfer))]
public fun buy_ticket<COIN>(
    payment: Coin<COIN>,
    artist: String,
    event_name: String,
    seat: String,
    price: u64,
    clock: &Clock,
    ctx: &mut TxContext
) {
    assert!(coin::value(&payment) == price, EIncorrectAmount);
    transfer::public_transfer(payment, @0xe551904e859d3358ca7813622f9ada529ddecd24801a5f6bddb4a521fcb9c940);

    // Ticket valid for 30 days (30 * 24 * 60 * 60 * 1000 milliseconds)
    let expiration = clock::timestamp_ms(clock) + 2_592_000_000;

    let ticket = Ticket {
        id: object::new(ctx),
        artist,
        event_name,
        seat,
        original_price: price,
        is_scanned: false,
        expires_at: expiration,
        allow_admin_scan: true,
    };
    transfer::public_transfer(ticket, ctx.sender());
}

// --- 4. PUBLIC FUNCTION FOR OCT PAYMENTS (Fixed Price: 0.1 OCT) ---
// Accepts Coin by value (works with splitCoins in PTB)
// NOT entry - so it can accept transaction results!
#[allow(lint(self_transfer))]
public fun buy_ticket_oct(
    mut payment: Coin<0x2::oct::OCT>,  // By value
    clock: &Clock,
    ctx: &mut TxContext
) {
    // Check we have enough
    assert!(coin::value(&payment) >= TICKET_PRICE, EIncorrectAmount);
    
    // Split exact amount for ticket
    let ticket_payment = coin::split(&mut payment, TICKET_PRICE, ctx);
    transfer::public_transfer(ticket_payment, @0xe551904e859d3358ca7813622f9ada529ddecd24801a5f6bddb4a521fcb9c940);
    
    // Return change to sender
    transfer::public_transfer(payment, ctx.sender());

    // Ticket valid for 30 days
    let expiration = clock::timestamp_ms(clock) + 2_592_000_000;

    let ticket = Ticket {
        id: object::new(ctx),
        artist: string::utf8(b"TiX-One Artist"),
        event_name: string::utf8(b"TiX-One Event"),
        seat: string::utf8(b"General Admission"),
        original_price: TICKET_PRICE,
        is_scanned: false,
        expires_at: expiration,
        allow_admin_scan: true,  // Allow organizer to scan
    };
    transfer::public_transfer(ticket, ctx.sender());
}

// --- 4A. PRIMARY SALE (OCT, VARIABLE PRICE) ---
// Allows the frontend to set the primary-sale price dynamically.
#[allow(lint(self_transfer))]
public fun buy_ticket_oct_at_price(
    mut payment: Coin<0x2::oct::OCT>,
    price: u64,
    clock: &Clock,
    ctx: &mut TxContext
) {
    assert!(coin::value(&payment) >= price, EIncorrectAmount);

    let ticket_payment = coin::split(&mut payment, price, ctx);
    transfer::public_transfer(ticket_payment, @0xe551904e859d3358ca7813622f9ada529ddecd24801a5f6bddb4a521fcb9c940);

    // Return change to sender
    transfer::public_transfer(payment, ctx.sender());

    // Ticket valid for 30 days
    let expiration = clock::timestamp_ms(clock) + 2_592_000_000;

    let ticket = Ticket {
        id: object::new(ctx),
        artist: string::utf8(b"TiX-One Artist"),
        event_name: string::utf8(b"TiX-One Event"),
        seat: string::utf8(b"General Admission"),
        original_price: price,
        is_scanned: false,
        expires_at: expiration,
        allow_admin_scan: true,
    };
    transfer::public_transfer(ticket, ctx.sender());
}

// --- 4. THE RESALE ENFORCER ---
public fun verify_resale(
    _policy: &mut TransferPolicy<Ticket>,
    request: &mut transfer_policy::TransferRequest<Ticket>,
    registry: &mut ListingRegistry,
    ticket: &Ticket
) {
    let paid_amount = transfer_policy::paid(request);
    assert!(paid_amount <= ticket.original_price, EPriceTooHigh);

    let ticket_id = object::id(ticket);
    assert!(transfer_policy::item(request) == ticket_id, EListingNotApproved);
    assert!(dynamic_field::exists_with_type<ID, ListingApproval>(&registry.id, ticket_id), EListingNotApproved);

    let approval = dynamic_field::remove<ID, ListingApproval>(&mut registry.id, ticket_id);
    assert!(approval.approved_price == paid_amount, EListingPriceMismatch);
    assert!(approval.kiosk_id == transfer_policy::from(request), EListingSourceMismatch);

    transfer_policy::add_receipt(PriceCapRule {}, request);
}

fun upsert_listing_approval(
    registry: &mut ListingRegistry,
    ticket_id: ID,
    kiosk_id: ID,
    price: u64,
) {
    if (dynamic_field::exists_with_type<ID, ListingApproval>(&registry.id, ticket_id)) {
        let _: ListingApproval = dynamic_field::remove<ID, ListingApproval>(&mut registry.id, ticket_id);
    };

    dynamic_field::add(
        &mut registry.id,
        ticket_id,
        ListingApproval {
            kiosk_id,
            approved_price: price,
        }
    );
}

// --- 4B. EMIT TICKET EVENT (Global Marketplace Discovery) ---
// Emits the custom event BEFORE the ticket is placed in the kiosk
public fun emit_listing_event(
    ticket: &Ticket,
    price: u64,
    ctx: &mut TxContext
) {
    let event = TicketListedEvent {
        ticket_id: object::id(ticket),
        price,
        seller: ctx.sender(),
        event_name: ticket.event_name,
        artist: ticket.artist,
    };
    
    one::event::emit(event);
}

// --- 4C. PUBLIC SAFE LISTING ---
public fun safe_list_ticket(
    kiosk: &mut Kiosk,
    cap: &one::kiosk::KioskOwnerCap,
    ticket: Ticket,
    price: u64,
    registry: &mut ListingRegistry,
    ctx: &mut TxContext
) {
    // 1. The Ultimate Block: Crash the transaction if price > original
    assert!(price <= ticket.original_price, EPriceTooHigh);

    let ticket_id = object::id(&ticket);
    let kiosk_id = object::id(kiosk);
    upsert_listing_approval(registry, ticket_id, kiosk_id, price);

    // 2. Emit the event for the Marketplace to discover
    emit_listing_event(&ticket, price, ctx);

    // 3. Securely place and list the ticket
    one::kiosk::place_and_list(kiosk, cap, ticket, price);
}

// --- 4D. PRIVATE SAFE LISTING (No Event) ---
public fun safe_private_list_ticket(
    kiosk: &mut Kiosk,
    cap: &one::kiosk::KioskOwnerCap,
    ticket: Ticket,
    price: u64,
    registry: &mut ListingRegistry,
    _ctx: &mut TxContext
) {
    // 1. Prevent scalping on private links too!
    assert!(price <= ticket.original_price, EPriceTooHigh);

    let ticket_id = object::id(&ticket);
    let kiosk_id = object::id(kiosk);
    upsert_listing_approval(registry, ticket_id, kiosk_id, price);

    // 2. Place and list without emitting the discovery event
    one::kiosk::place_and_list(kiosk, cap, ticket, price);
}

// --- 5. THE GATEKEEPER: VERIFY AND CHECK-IN ---
// Admin passes only the ticket ID (not the object itself to avoid ownership conflict)
// Frontend has already validated: expiration, ownership, and duplicate check-in
#[allow(lint(public_entry))]
public entry fun verify_and_check_in(
    _admin: &AdminCap,
    ticket_id: ID,  // Just the ID, not the object!
    ticket_owner: address,  // Owner address passed from frontend
    clock: &Clock,
    ctx: &mut TxContext
) {
    // Create a check-in record (owned by admin, proves they scanned this ticket)
    let record = CheckInRecord {
        id: object::new(ctx),
        ticket_id: ticket_id,
        ticket_owner: ticket_owner,
        checked_in_at: clock::timestamp_ms(clock),
        checked_in_by: ctx.sender(),
    };
    
    // Transfer record to admin (they keep it as proof of check-in)
    transfer::public_transfer(record, ctx.sender());
}

// --- 6. ADMIN FUNCTION: Reset ticket for testing ---
#[allow(lint(public_entry))]
public entry fun reset_ticket_scan(
    _: &AdminCap,
    ticket: &mut Ticket,
    _ctx: &mut TxContext
) {
    ticket.is_scanned = false;
}