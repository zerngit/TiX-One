import { createBrowserRouter } from "react-router";
import Home from "./pages/Home";
import ConcertDetail from "./pages/ConcertDetail";
import MyTicket from "./pages/MyTicket";
import Marketplace from "./pages/Marketplace";
import Scanner from "./pages/Scanner";
import Checkout from "./pages/Checkout";

export const router = createBrowserRouter([
  {
    path: "/",
    Component: Home,
  },
  {
    path: "/concert/:id",
    Component: ConcertDetail,
  },
  {
    path: "/my-ticket",
    Component: MyTicket,
  },
  {
    path: "/marketplace",
    Component: Marketplace,
  },
  {
    path: "/scanner",
    Component: Scanner,
  },
  {
    path: "/buy",
    Component: Checkout,
  },
]);
