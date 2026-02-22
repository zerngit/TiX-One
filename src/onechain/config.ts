export const PACKAGE_ID =
  "0x2ccc463b541701e399125048cfd9f022499eb7b0aa455cfefbac6ef89f5fcc82" as const;

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
  "0x6c087b51a6af5bfed33c2fdddb5810de750c7872c0e07d73725fd0e68bac6265" as const;
export const TICKET_LISTED_EVENT =
  `${PACKAGE_ID}::ticket::TicketListedEvent` as const;

// Scanner / admin
export const ADMIN_CAP_ID =
  "0xac2a2213bf63874b5e47adf961e882978cf1bddafd0cb1c9e28011a734b00364" as const;
