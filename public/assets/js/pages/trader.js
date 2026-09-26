import { $ } from "../core/dom.js";
import { initSite, getOptionalUser } from "../core/site.js";
import { mountTraderProfile } from "../components/trader-profile.js";

initSite();
const slug = location.pathname.split("/").pop();
getOptionalUser().then((user) => mountTraderProfile($("#profile"), { slug, signedIn: !!user, backHref: "/copy-trading" }));
