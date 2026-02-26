import { createBrowserRouter } from "react-router-dom";
import Home from "./pages/Home";
import ConcertDetail from "./pages/ConcertDetail";
import MyTicket from "./pages/MyTicket";
import Marketplace from "./pages/Marketplace";
import Scanner from "./pages/Scanner";
import Checkout from "./pages/Checkout";
import BotDetected from "./pages/BotDetected";
import Appeal from "./pages/Appeal";

export const router = createBrowserRouter([
  {
    path: "/",
    element: <Home />,
  },
  {
    path: "/concert/:id",
    element: <ConcertDetail />,
  },
  {
    path: "/my-ticket",
    element: <MyTicket />,
  },
  {
    path: "/marketplace",
    element: <Marketplace />,
  },
  {
    path: "/scanner",
    element: <Scanner />,
  },
  {
    path: "/buy",
    element: <Checkout />,
  },
  {
    path: "/bot-detected",
    element: <BotDetected />,
  },
  {
    path: "/appeal",
    element: <Appeal />,
  },
]);