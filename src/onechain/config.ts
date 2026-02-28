export const PACKAGE_ID =
  "0xc9653879dd6f0b0ba3821ec5413bd0bdb511ae83e3d3f7a1f5852522f6aa4fc7" as const;

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
  "0xddcf786fa68fb745b78d56165bda3bc5762333c074014134a0ddec4b03d1106c" as const;
export const TICKET_LISTED_EVENT =
  `${PACKAGE_ID}::ticket::TicketListedEvent` as const;

// Scanner / admin
export const ADMIN_CAP_ID =
  "0xbce753f2db5fc5d1b5a56924b07c75d2ec866ca89b524ca4753b0967f10b1050" as const;

// Concert shared-object type (for getObject / queryEvents filters)
export const CONCERT_TYPE = `${PACKAGE_ID}::ticket::Concert` as const;

// Backend verifier — set automatically by scripts/3-init-verifier.sh
// Run: bash scripts/1-deploy.sh && bash scripts/3-init-verifier.sh
export const BACKEND_VERIFIER_ID =
  "0x69d5afeff95fa3d125c947c72a2b41da616b1d49620bde05f20052c88a27b1ee" as const; // ← populated by 3-init-verifier.sh
