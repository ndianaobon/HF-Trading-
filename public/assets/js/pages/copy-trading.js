import { $ } from "../core/dom.js";
import { initSite } from "../core/site.js";
import { mountTraderDirectory } from "../components/trader-directory.js";

initSite();
mountTraderDirectory($("#directory"), { profileBase: "/copy-trading" });
