export const PACKAGE_ID =
  "0x2d826c906da84480a0f7605fded8d31fe9ba770542787ae956070d1499b35711" as const;

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
  "0x3722a728af92e3a3537630e198882372d1288ef8762df5d2b3ba79cab6271bdd" as const;
export const LISTING_REGISTRY_ID =
  "0xd05ccea4196317fd22bf1c8d5bde699235cda73f0f7253885b310a156c919f04" as const;
export const TICKET_LISTED_EVENT =
  `${PACKAGE_ID}::ticket::TicketListedEvent` as const;

// Scanner / admin
export const ADMIN_CAP_ID =
  "0x2b7b448813f9a4dba20fd3ef2b545994da98e3c7643089fddf6e23f622b4f39d" as const;

// Concert shared-object type (for getObject / queryEvents filters)
export const CONCERT_TYPE = `${PACKAGE_ID}::ticket::Concert` as const;

// Waitlist object type (for on-chain queue queries)
export const WAITLIST_TYPE = `${PACKAGE_ID}::ticket::Waitlist` as const;

// Backend verifier — set automatically by scripts/3-init-verifier.sh
// Run: bash scripts/1-deploy.sh && bash scripts/3-init-verifier.sh
export const BACKEND_VERIFIER_ID =
  "0xd7bd967886b6fb605ee40bc46a5752cedefc336a4463875a85546cab5eb00db8" as const; // ← populated by 3-init-verifier.sh
