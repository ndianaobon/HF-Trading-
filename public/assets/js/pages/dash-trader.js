import { $ } from "../core/dom.js";
import { initApp } from "../core/app-shell.js";
import { mountTraderProfile } from "../components/trader-profile.js";

await initApp();
const view = $("#view");
view.removeAttribute("aria-busy");
const slug = location.pathname.split("/").pop();
mountTraderProfile(view, { slug, signedIn: true, backHref: "/dashboard/copy-trading" });
