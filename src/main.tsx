import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  SuiClientProvider,
  WalletProvider,
  createNetworkConfig,
} from "@mysten/dapp-kit";
import "@mysten/dapp-kit/dist/index.css";

const queryClient = new QueryClient();

// OneChain testnet RPC
const { networkConfig } = createNetworkConfig({
  testnet: {
    url: "https://rpc-testnet.onelabs.cc:443",
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
