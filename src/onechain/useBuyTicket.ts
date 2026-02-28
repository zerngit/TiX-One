import { useState } from "react";
import {
  useCurrentAccount,
  useSignAndExecuteTransaction,
  useSuiClient,
} from "@mysten/dapp-kit";
import { Transaction } from "@mysten/sui/transactions";
import { bcs } from "@mysten/sui/bcs";
import {
  CLOCK_OBJECT_ID,
  OCT_TYPE,
  PACKAGE_ID,
  TICKET_PRICE_MIST,
  BACKEND_VERIFIER_ID,
} from "./config";



export function useBuyTicket() {
  const currentAccount = useCurrentAccount();
  const suiClient = useSuiClient();
  const { mutateAsync: signAndExecuteTransaction } =
    useSignAndExecuteTransaction();

  const [isBuying, setIsBuying] = useState(false);
  const [buyError, setBuyError] = useState<string>("");
  const [buyDigest, setBuyDigest] = useState<string>("");

  const buyTicket = async () => {
    setBuyError("");
    setBuyDigest("");

    if (!currentAccount) {
      setBuyError("Connect OneWallet to continue.");
      return;
    }

    setIsBuying(true);
    try {
      const tx = new Transaction();
      tx.setSender(currentAccount.address);
      tx.setGasBudget(100_000_000);

      const [tempCoin] = tx.splitCoins(tx.gas, [tx.pure.u64(TICKET_PRICE_MIST)]);

      tx.moveCall({
        target: `${PACKAGE_ID}::ticket::buy_ticket_oct`,
        arguments: [tempCoin, tx.object(CLOCK_OBJECT_ID)],
      });

      const result = await signAndExecuteTransaction({ transaction: tx });

      const receipt = await suiClient.waitForTransaction({
        digest: result.digest,
        options: { showEffects: true },
      });

      if (receipt.effects?.status?.status === "success") {
        setBuyDigest(result.digest);
      } else {
        setBuyError(
          `On-chain error: ${receipt.effects?.status?.error || "unknown"}`
        );
      }
    } catch (e: any) {
      setBuyError(e?.message || "Transaction failed");
    } finally {
      setIsBuying(false);
    }
  };

  const buyTicketAtPrice = async (
    priceMist: bigint,
    concertObjectId: string,
    seat = "General Admission",
    quantity = 1
  ) => {
    setBuyError("");
    setBuyDigest("");

    if (!currentAccount) {
      setBuyError("Connect OneWallet to continue.");
      return null;
    }
    if (priceMist <= 0n) {
      setBuyError("Ticket price must be greater than 0.");
      return null;
    }
    if (!concertObjectId) {
      setBuyError("Concert not linked to blockchain yet. Please try again shortly.");
      return null;
    }
    if (quantity < 1) {
      setBuyError("Quantity must be at least 1.");
      return null;
    }

    setIsBuying(true);
    try {
      const tx = new Transaction();
      tx.setSender(currentAccount.address);
      tx.setGasBudget(100_000_000);

      // Split the total cost (price × quantity) in a single coin
      const total = priceMist * BigInt(quantity);
      const [tempCoin] = tx.splitCoins(tx.gas, [tx.pure.u64(total)]);

      tx.moveCall({
        target: `${PACKAGE_ID}::ticket::buy_ticket_oct_at_price`,
        arguments: [
          tx.object(concertObjectId),  // &mut Concert — enforces supply cap
          tempCoin,
          tx.pure.string(seat),
          tx.pure.u64(priceMist),      // unit price
          tx.pure.u64(quantity),       // quantity
          tx.object(CLOCK_OBJECT_ID),
        ],
      });

      const result = await signAndExecuteTransaction({ transaction: tx });

      const receipt = await suiClient.waitForTransaction({
        digest: result.digest,
        options: { showEffects: true },
      });

      if (receipt.effects?.status?.status === "success") {
        setBuyDigest(result.digest);
        return result.digest;
      }

      setBuyError(`On-chain error: ${receipt.effects?.status?.error || "unknown"}`);
      return null;
    } catch (e: any) {
      setBuyError(e?.message || "Transaction failed");
      return null;
    } finally {
      setIsBuying(false);
    }
  };

  /**
   * Fan-presale purchase — requires an Ed25519 signature from the backend
   * proving the buyer passed the Spotify fan check.
   * The signature is obtained by calling GET /sign-fan-purchase on the backend.
   */
  const buyVerifiedFanTicket = async (
    priceMist: bigint,
    concertObjectId: string,
    signatureHex: string,
    seat = "Fan Presale"
  ) => {
    setBuyError("");
    setBuyDigest("");

    if (!currentAccount) {
      setBuyError("Connect OneWallet to continue.");
      return null;
    }
    if (!concertObjectId) {
      setBuyError("Concert not linked to blockchain yet.");
      return null;
    }
    if (!BACKEND_VERIFIER_ID) {
      setBuyError("BackendVerifier not deployed yet. Run scripts/3-init-verifier.sh.");
      return null;
    }
    if (!signatureHex || signatureHex.length !== 128) {
      setBuyError("Invalid fan verification signature.");
      return null;
    }

    // Convert hex signature → Uint8Array
    const sigBytes = Array.from(
      Buffer.from(signatureHex, "hex")
    );

    setIsBuying(true);
    try {
      const tx = new Transaction();
      tx.setSender(currentAccount.address);
      tx.setGasBudget(100_000_000);

      const [tempCoin] = tx.splitCoins(tx.gas, [tx.pure.u64(priceMist)]);

      tx.moveCall({
        target: `${PACKAGE_ID}::ticket::buy_verified_fan_ticket`,
        arguments: [
          tx.object(concertObjectId),          // &mut Concert
          tx.object(BACKEND_VERIFIER_ID),      // &BackendVerifier
          tx.pure(bcs.vector(bcs.U8).serialize(sigBytes)), // signature: vector<u8>
          tempCoin,                            // payment coin
          tx.pure.string(seat),
          tx.pure.u64(priceMist),
          tx.object(CLOCK_OBJECT_ID),
        ],
      });

      const result = await signAndExecuteTransaction({ transaction: tx });
      const receipt = await suiClient.waitForTransaction({
        digest: result.digest,
        options: { showEffects: true },
      });

      if (receipt.effects?.status?.status === "success") {
        setBuyDigest(result.digest);
        return result.digest;
      }

      setBuyError(`On-chain error: ${receipt.effects?.status?.error || "unknown"}`);
      return null;
    } catch (e: any) {
      setBuyError(e?.message || "Transaction failed");
      return null;
    } finally {
      setIsBuying(false);
    }
  };

  // -------------------------------------------------------
  // Waitlist: join / leave / fulfill
  // -------------------------------------------------------

  /**
   * Join the escrow waitlist for a sold-out concert.
   * `faceValueMist` must be exactly the concert's original ticket price.
   */
  const joinWaitlist = async (
    waitlistObjectId: string,
    faceValueMist: bigint
  ) => {
    setBuyError("");
    setBuyDigest("");
    if (!currentAccount) { setBuyError("Connect OneWallet to continue."); return null; }
    if (!waitlistObjectId) { setBuyError("Waitlist object ID not set."); return null; }

    setIsBuying(true);
    try {
      const tx = new Transaction();
      tx.setSender(currentAccount.address);
      tx.setGasBudget(100_000_000);
      const [escrowCoin] = tx.splitCoins(tx.gas, [tx.pure.u64(faceValueMist)]);
      tx.moveCall({
        target: `${PACKAGE_ID}::ticket::join_waitlist`,
        arguments: [tx.object(waitlistObjectId), escrowCoin],
      });
      const result = await signAndExecuteTransaction({ transaction: tx });
      const receipt = await suiClient.waitForTransaction({ digest: result.digest, options: { showEffects: true } });
      if (receipt.effects?.status?.status === "success") { setBuyDigest(result.digest); return result.digest; }
      setBuyError(`On-chain error: ${receipt.effects?.status?.error || "unknown"}`);
      return null;
    } catch (e: any) { setBuyError(e?.message || "Transaction failed"); return null; }
    finally { setIsBuying(false); }
  };

  /**
   * Leave the waitlist and reclaim your escrowed OCT.
   */
  const leaveWaitlist = async (waitlistObjectId: string) => {
    setBuyError("");
    setBuyDigest("");
    if (!currentAccount) { setBuyError("Connect OneWallet to continue."); return null; }
    if (!waitlistObjectId) { setBuyError("Waitlist object ID not set."); return null; }

    setIsBuying(true);
    try {
      const tx = new Transaction();
      tx.setSender(currentAccount.address);
      tx.setGasBudget(100_000_000);
      tx.moveCall({
        target: `${PACKAGE_ID}::ticket::leave_waitlist`,
        arguments: [tx.object(waitlistObjectId)],
      });
      const result = await signAndExecuteTransaction({ transaction: tx });
      const receipt = await suiClient.waitForTransaction({ digest: result.digest, options: { showEffects: true } });
      if (receipt.effects?.status?.status === "success") { setBuyDigest(result.digest); return result.digest; }
      setBuyError(`On-chain error: ${receipt.effects?.status?.error || "unknown"}`);
      return null;
    } catch (e: any) { setBuyError(e?.message || "Transaction failed"); return null; }
    finally { setIsBuying(false); }
  };

  /**
   * Fulfill the first waitlist order (FIFO).
   * The caller passes their Ticket object ID + the Concert + Waitlist object IDs.
   * The ticket goes to the first waiting buyer; the face-value OCT goes to the seller.
   */
  const fulfillWaitlistOrder = async (
    ticketObjectId: string,
    concertObjectId: string,
    waitlistObjectId: string
  ) => {
    setBuyError("");
    setBuyDigest("");
    if (!currentAccount) { setBuyError("Connect OneWallet to continue."); return null; }

    setIsBuying(true);
    try {
      const tx = new Transaction();
      tx.setSender(currentAccount.address);
      tx.setGasBudget(100_000_000);
      tx.moveCall({
        target: `${PACKAGE_ID}::ticket::fulfill_waitlist_order`,
        arguments: [
          tx.object(waitlistObjectId),
          tx.object(ticketObjectId),
          tx.object(concertObjectId),
        ],
      });
      const result = await signAndExecuteTransaction({ transaction: tx });
      const receipt = await suiClient.waitForTransaction({ digest: result.digest, options: { showEffects: true } });
      if (receipt.effects?.status?.status === "success") { setBuyDigest(result.digest); return result.digest; }
      setBuyError(`On-chain error: ${receipt.effects?.status?.error || "unknown"}`);
      return null;
    } catch (e: any) { setBuyError(e?.message || "Transaction failed"); return null; }
    finally { setIsBuying(false); }
  };

  return {
    buyTicket,
    buyTicketAtPrice,
    buyVerifiedFanTicket,
    joinWaitlist,
    leaveWaitlist,
    fulfillWaitlistOrder,
    isBuying,
    buyError,
    buyDigest,
    isConnected: !!currentAccount,
    address: currentAccount?.address,
  };
}
