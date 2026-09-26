import { html, $, on, mount, cx } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { api } from "../core/api.js";
import { watch, invalidate } from "../core/store.js";
import { initApp } from "../core/app-shell.js";
import { errorState, emptyState, skeletonRows, pageHeader, pagination, tabs } from "../core/ui.js";
import { formatDate, timeAgo } from "../core/format.js";
import { notificationIcon } from "../components/notification-icon.js";

await initApp();
const view = $("#view");
view.removeAttribute("aria-busy");

mount(
  view,
  html`${pageHeader({
      title: "Notifications",
      description: "Trade executions, funding updates, security alerts and announcements.",
      actions: html`<button type="button" class="btn btn-secondary" data-all disabled>${icon("check-check", "h-4 w-4")} Mark all as read</button>`,
    })}
    <section class="card">
      <div class="px-4 pt-1" data-tabs></div>
      <div class="border-t border-line" data-list>${skeletonRows(6, "p-4")}</div>
      <div class="border-t border-line px-4 py-3" data-pages hidden></div>
    </section>`,
);

let filter = "all";
let page = 1;
let items = [];
let unsub = null;

const mark = async (body) => {
  await api("/api/notifications", { body });
  invalidate("/api/notifications");
};

function load() {
  unsub?.();
  unsub = watch(`/api/notifications?filter=${filter}&page=${page}&pageSize=20`, ({ data, error }) => {
    mount(
      $("[data-tabs]", view),
      tabs(
        [
          { value: "all", label: "All" },
          { value: "unread", label: "Unread", count: data?.unread },
        ],
        filter,
        { name: "filter", cls: "border-0" },
      ),
    );
    if (!data) return error && mount($("[data-list]", view), errorState({ message: error.message }));
    items = data.items;
    $("[data-all]", view).disabled = !data.unread;
    mount(
      $("[data-list]", view),
      !items.length
        ? emptyState({ iconName: "bell", title: filter === "unread" ? "No unread notifications" : "No notifications yet" })
        : html`<ul>${items.map(
            (n) => html`<li class="${cx("flex gap-4 border-b border-line/60 px-5 py-4 last:border-0", !n.readAt && "bg-accent/[0.03]")}">
              ${notificationIcon(n.type, "h-10 w-10")}
              <div class="min-w-0 flex-1">
                <div class="flex flex-wrap items-start justify-between gap-2"><p class="${cx("text-sm", n.readAt ? "text-fg" : "font-semibold text-white")}">${n.title}</p><span class="text-xs text-dim" title="${formatDate(n.createdAt)}">${timeAgo(n.createdAt)}</span></div>
                <p class="mt-1 text-sm text-muted">${n.body}</p>
                <div class="mt-2 flex gap-4 text-xs font-semibold">
                  ${n.link ? html`<button type="button" class="text-accent hover:text-accent-strong" data-open="${n.id}">View details</button>` : ""}
                  ${!n.readAt ? html`<button type="button" class="text-muted hover:text-white" data-read="${n.id}">Mark as read</button>` : ""}
                </div>
              </div>
            </li>`,
          )}</ul>`,
    );
    const pages = $("[data-pages]", view);
    pages.hidden = data.pageCount <= 1;
    mount(pages, pagination(page, data.pageCount, data.total));
  });
}

on(view, "click", "[data-tabs] [data-filter]", (_e, b) => {
  filter = b.dataset.filter;
  page = 1;
  load();
});
on(view, "click", "[data-pages] [data-page]", (_e, b) => {
  page = Number(b.dataset.page);
  load();
});
on(view, "click", "[data-all]", () => mark({ all: true }));
on(view, "click", "[data-read]", (_e, b) => mark({ ids: [b.dataset.read] }));
on(view, "click", "[data-open]", async (_e, b) => {
  const n = items.find((x) => x.id === b.dataset.open);
  if (!n) return;
  if (!n.readAt) await mark({ ids: [n.id] }).catch(() => {});
  // Only same-site links are followed.
  if (n.link.startsWith("/") && !n.link.startsWith("//")) location.href = n.link;
});
load();
