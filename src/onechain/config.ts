export const PACKAGE_ID =
  "0x21d1519a30847bf2e66f0e331bbb3b3eeba8fe73deee72a22ae14dde337b38f8" as const;

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
  "0xc2d453865963bfe77eb1f5b4b23d45c14d68a2f95e8bdf6121dae6e22c461c5a" as const;
export const TICKET_LISTED_EVENT =
  `${PACKAGE_ID}::ticket::TicketListedEvent` as const;

// Scanner / admin
export const ADMIN_CAP_ID =
  "0x400aec913e42c0a184b3cec00b1a8524c20568847e2e1b99b8c820bbcc15e028" as const;

// Concert shared-object type (for getObject / queryEvents filters)
export const CONCERT_TYPE = `${PACKAGE_ID}::ticket::Concert` as const;

// Waitlist object type (for on-chain queue queries)
export const WAITLIST_TYPE = `${PACKAGE_ID}::ticket::Waitlist` as const;

// Backend verifier — set automatically by scripts/3-init-verifier.sh
// Run: bash scripts/1-deploy.sh && bash scripts/3-init-verifier.sh
export const BACKEND_VERIFIER_ID =
  "0x251f4753ae34f3be8cfa8381c7bb4a6f261e2f0aba5e7f0ebc005b755806fc9f" as const; // ← populated by 3-init-verifier.sh
