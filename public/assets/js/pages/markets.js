import { $, param } from "../core/dom.js";
import { initSite, getOptionalUser } from "../core/site.js";
import { mountMarketTable } from "../components/market-table.js";
import { mountTopMovers } from "../components/top-movers.js";

initSite();
mountTopMovers($("#top-movers"));
getOptionalUser().then((user) =>
  mountMarketTable($("#market-table"), {
    categories: ["FAVORITES", "ALL", "SPOT", "STABLECOIN", "DEFI", "LAYER1", "LAYER2", "MEME"],
    initial: param("category") ?? "ALL",
    signedIn: !!user,
  }),
);
