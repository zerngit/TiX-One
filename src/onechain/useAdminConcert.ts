import { useState } from "react";
import {
  useCurrentAccount,
  useSignAndExecuteTransaction,
  useSuiClient,
} from "@mysten/dapp-kit";
import { Transaction } from "@mysten/sui/transactions";
import { PACKAGE_ID } from "./config";
import { supabase } from "../lib/supabase";

// ─── Types ──────────────────────────────────────────────────────────────────

export type CreateStep =
  | "idle"
  | "tx_concert"
  | "tx_waitlist"
  | "saving"
  | "done"
  | "error";

export interface ConcertFormData {
  // Core
  artist: string;
  title: string;
  genre: string;
  date: string;           // "YYYY-MM-DD"
  time: string;           // "HH:MM" (24-hour)
  maxTickets: string;     // kept as string for form input
  priceOct: string;       // e.g. "0.05"
  // Venue
  venue: string;
  location: string;       // "City, State / City, Country"
  region: string;
  artistOrigin: string;
  // Media
  posterUrl: string;
  description: string;
  // Waitlist
  waitlistPriceOct: string;    // deposit (defaults to ticket price)
  waitlistExpiresAt: string;   // "YYYY-MM-DDTHH:MM"
  // Sale schedule (optional — leave blank to use default 14-day hardcode)
  publicSaleTime: string;      // "YYYY-MM-DDTHH:MM" or ""
  fanSaleTime: string;         // "YYYY-MM-DDTHH:MM" or ""
}

export interface CreateResult {
  concertObjectId: string;
  waitlistObjectId: string;
  concertId: string;
}

// ─── Helper ─────────────────────────────────────────────────────────────────

/** Convert a decimal OCT string (e.g. "0.05") to a u64 mist BigInt */
function octToMist(oct: string): bigint {
  const str = oct.trim() || "0";
  const [whole, frac = ""] = str.split(".");
  const fracPadded = frac.padEnd(9, "0").slice(0, 9);
  return BigInt(whole || "0") * 1_000_000_000n + BigInt(fracPadded);
}

/**
 * Convert a datetime-local string ("YYYY-MM-DDTHH:MM", no timezone) to a
 * UTC ISO string by parsing it as local time in the user's browser.
 * Without this, PostgreSQL TIMESTAMPTZ treats the bare string as UTC.
 */
function localToISO(local: string): string | null {
  if (!local) return null;
  // Ensure seconds are present so Date parses it as local time (not UTC)
  const normalised = local.length === 16 ? `${local}:00` : local;
  const d = new Date(normalised);
  if (isNaN(d.getTime())) return null;
  return d.toISOString(); // converts local → UTC
}

/** Format a date string "YYYY-MM-DD" to "March 1, 2026" */
function formatDateText(dateStr: string): string {
  // Parse as local time to avoid UTC-off-by-one
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

/** Format a time string "HH:MM" to "8:00 PM" */
function formatTimeText(timeStr: string): string {
  const [h, min] = timeStr.split(":").map(Number);
  const dt = new Date(1970, 0, 1, h, min);
  return dt.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useAdminConcert() {
  const currentAccount = useCurrentAccount();
  const suiClient = useSuiClient();
  const { mutateAsync: signAndExecuteTransaction } = useSignAndExecuteTransaction();

  const [step, setStep] = useState<CreateStep>("idle");
  const [error, setError] = useState("");
  const [result, setResult] = useState<CreateResult | null>(null);

  const createConcertAndWaitlist = async (
    form: ConcertFormData
  ): Promise<CreateResult | null> => {
    if (!currentAccount) {
      setError("Connect your wallet first.");
      return null;
    }

    setError("");
    setResult(null);

    // ── Step 1: create_concert on-chain ─────────────────────────────────
    setStep("tx_concert");
    let concertObjectId = "";
    try {
      const tx = new Transaction();
      tx.setSender(currentAccount.address);
      tx.setGasBudget(20_000_000);
      tx.moveCall({
        target: `${PACKAGE_ID}::ticket::create_concert`,
        arguments: [
          tx.pure.string(form.artist),
          tx.pure.string(form.title),
          tx.pure.u64(parseInt(form.maxTickets, 10)),
        ],
      });

      const res = await signAndExecuteTransaction({ transaction: tx });
      const receipt = await suiClient.waitForTransaction({
        digest: res.digest,
        options: { showObjectChanges: true },
      });

      const concertChange = (receipt.objectChanges ?? []).find(
        (c: any) =>
          c.type === "created" &&
          (c.objectType ?? "").includes("::ticket::Concert")
      ) as any;

      if (!concertChange?.objectId) {
        throw new Error("Concert object not found in transaction changes.");
      }
      concertObjectId = concertChange.objectId;
    } catch (e: any) {
      setError(e?.message || "Failed to create concert on-chain.");
      setStep("error");
      return null;
    }

    // ── Step 2: create_waitlist on-chain ─────────────────────────────────
    setStep("tx_waitlist");
    let waitlistObjectId = "";
    try {
      const expiresMs = BigInt(new Date(form.waitlistExpiresAt).getTime());
      const faceMist = octToMist(form.waitlistPriceOct);

      const tx = new Transaction();
      tx.setSender(currentAccount.address);
      tx.setGasBudget(20_000_000);
      tx.moveCall({
        target: `${PACKAGE_ID}::ticket::create_waitlist`,
        arguments: [
          tx.object(concertObjectId),
          tx.pure.u64(faceMist),
          tx.pure.u64(expiresMs),
        ],
      });

      const res = await signAndExecuteTransaction({ transaction: tx });
      const receipt = await suiClient.waitForTransaction({
        digest: res.digest,
        options: { showObjectChanges: true },
      });

      const wlChange = (receipt.objectChanges ?? []).find(
        (c: any) =>
          c.type === "created" &&
          (c.objectType ?? "").includes("::ticket::Waitlist")
      ) as any;

      if (!wlChange?.objectId) {
        throw new Error("Waitlist object not found in transaction changes.");
      }
      waitlistObjectId = wlChange.objectId;
    } catch (e: any) {
      setError(e?.message || "Failed to create waitlist on-chain.");
      setStep("error");
      return null;
    }

    // ── Step 3: Save to Supabase ─────────────────────────────────────────
    setStep("saving");
    const concertId = Date.now().toString();

    if (supabase) {
      const priceText = `${parseFloat(form.priceOct)} OCT`;
      const { error: dbErr } = await supabase.from("concerts").insert({
        id: concertId,
        artist: form.artist,
        title: form.title,
        date: formatDateText(form.date),
        time: formatTimeText(form.time),
        venue: form.venue,
        location: form.location,
        region: form.region,
        artistOrigin: form.artistOrigin,
        price: priceText,
        posterUrl:
          form.posterUrl ||
          "https://images.unsplash.com/photo-1540039155733-5bb30b53aa14?w=1080&q=80",
        description: form.description,
        availableTickets: parseInt(form.maxTickets, 10),
        genre: form.genre,
        concert_object_id: concertObjectId,
        waitlist_object_id: waitlistObjectId,
        public_sale_time: localToISO(form.publicSaleTime),
        fan_sale_time: localToISO(form.fanSaleTime),
      });
      if (dbErr) {
        // Not fatal — objects are on-chain; log for debug
        console.error("[Supabase] insert concert error:", dbErr.message);
      }
    }

    const finalResult: CreateResult = {
      concertObjectId,
      waitlistObjectId,
      concertId,
    };
    setResult(finalResult);
    setStep("done");
    return finalResult;
  };

  const reset = () => {
    setStep("idle");
    setError("");
    setResult(null);
  };

  return { step, error, result, createConcertAndWaitlist, reset };
}
