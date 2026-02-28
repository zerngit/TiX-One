export const PACKAGE_ID =
  "0x9ee406ce3b3541cd795a05585460d70fbc86ec79108b7f08391c265756d6613b" as const;

// Coins / system objects
export const OCT_TYPE = "0x2::oct::OCT" as const;
export const CLOCK_OBJECT_ID = "0x6" as const;

// Primary sale (mint)
export const TICKET_PRICE_MIST = 100_000_000n as const; // 0.1 OCT

// Types
export const TICKET_TYPE = `${PACKAGE_ID}::ticket::Ticket` as const;
export const KIOSK_TYPE = "0x2::kiosk::Kiosk" as const;
export const KIOSK_OWNER_CAP_TYPE = "0x2::kiosk::KioskOwnerCap" as const;

// Marketplace / policy
export const TRANSFER_POLICY_ID =
  "0x86bf15a86b41e7ebd146f452dc6f431078191eb748ff3b2f2521b56c723b6107" as const;
export const LISTING_REGISTRY_ID =
  "0xc54cc507320cf041428152d3e1b366b6d3dd71bd433e5d547f82fa11ce5b553b" as const;
export const TICKET_LISTED_EVENT =
  `${PACKAGE_ID}::ticket::TicketListedEvent` as const;

// Scanner / admin
export const ADMIN_CAP_ID =
  "0x530587df89444483823cb8ce41e7679c11a077c7db8371a831c22e18a878d0c3" as const;

// Concert shared-object type (for getObject / queryEvents filters)
export const CONCERT_TYPE = `${PACKAGE_ID}::ticket::Concert` as const;

// Waitlist object type (for on-chain queue queries)
export const WAITLIST_TYPE = `${PACKAGE_ID}::ticket::Waitlist` as const;

// Backend verifier — set automatically by scripts/3-init-verifier.sh
// Run: bash scripts/1-deploy.sh && bash scripts/3-init-verifier.sh
export const BACKEND_VERIFIER_ID =
  "0x245ca3ccbed219e8640050d408e1174daade374bd56bd69a8f17d89b6ace7abb" as const; // ← populated by 3-init-verifier.sh
