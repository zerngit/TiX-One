import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  SuiClientProvider,
  WalletProvider,
  createNetworkConfig,
} from "@mysten/dapp-kit";
import "@mysten/dapp-kit/dist/index.css";

const queryClient = new QueryClient();

const RPC_URL = window.location.hostname.includes("vercel.app")
  ? "/onechain-rpc"
  : "https://rpc-testnet.onelabs.443";

// 2. UPDATE THE NETWORK CONFIG TO USE THE VARIABLE:
const { networkConfig } = createNetworkConfig({
  testnet: {
    url: RPC_URL, // <--- Replaced the hardcoded string here
  },
});

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    <SuiClientProvider networks={networkConfig} defaultNetwork="testnet">
      <WalletProvider autoConnect preferredWallets={["OneWallet"]}>
        <App />
      </WalletProvider>
    </SuiClientProvider>
  </QueryClientProvider>
);
