import { useState } from "react";
import {
  useCurrentAccount,
  useSignAndExecuteTransaction,
  useSuiClient,
} from "@mysten/dapp-kit";
import { Transaction } from "@mysten/sui/transactions";
import {
  CLOCK_OBJECT_ID,
  OCT_TYPE,
  PACKAGE_ID,
  TICKET_PRICE_MIST,
} from "./config";

type TicketMetadata = {
  artist: string;
  eventName: string;
  seat: string;
};

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
    metadata?: TicketMetadata
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

    setIsBuying(true);
    try {
      const tx = new Transaction();
      tx.setSender(currentAccount.address);
      tx.setGasBudget(100_000_000);

      const [tempCoin] = tx.splitCoins(tx.gas, [tx.pure.u64(priceMist)]);

      if (metadata) {
        tx.moveCall({
          target: `${PACKAGE_ID}::ticket::buy_ticket`,
          typeArguments: [OCT_TYPE],
          arguments: [
            tempCoin,
            tx.pure.string(metadata.artist),
            tx.pure.string(metadata.eventName),
            tx.pure.string(metadata.seat),
            tx.pure.u64(priceMist),
            tx.object(CLOCK_OBJECT_ID),
          ],
        });
      } else {
        tx.moveCall({
          target: `${PACKAGE_ID}::ticket::buy_ticket_oct_at_price`,
          arguments: [tempCoin, tx.pure.u64(priceMist), tx.object(CLOCK_OBJECT_ID)],
        });
      }

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

  return {
    buyTicket,
    buyTicketAtPrice,
    isBuying,
    buyError,
    buyDigest,
    isConnected: !!currentAccount,
    address: currentAccount?.address,
  };
}
