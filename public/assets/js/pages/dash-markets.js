import { html, $, mount, param } from "../core/dom.js";
import { initApp } from "../core/app-shell.js";
import { pageHeader } from "../core/ui.js";
import { mountMarketTable } from "../components/market-table.js";
import { mountTopMovers } from "../components/top-movers.js";

await initApp();
const view = $("#view");
view.removeAttribute("aria-busy");
mount(
  view,
  html`${pageHeader({ title: "Markets", description: "Live spot markets. Star a market to add it to your favorites." })}
    <div class="space-y-6"><div data-movers></div><section class="card overflow-hidden" data-table></section></div>`,
);
mountTopMovers($("[data-movers]", view));
mountMarketTable($("[data-table]", view), {
  categories: ["FAVORITES", "ALL", "SPOT", "STABLECOIN", "DEFI", "LAYER1", "LAYER2", "MEME"],
  initial: param("category") ?? "ALL",
  signedIn: true,
});
