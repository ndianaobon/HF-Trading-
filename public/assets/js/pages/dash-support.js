import { html, raw, $, on, mount, param } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { api, ApiError } from "../core/api.js";
import { watch, invalidate } from "../core/store.js";
import { initApp } from "../core/app-shell.js";
import { card, badge, emptyState, pageHeader, statusBadge, toast, openModal, DataTable } from "../core/ui.js";
import { field, selectField, textareaField, bindForm, rules } from "../core/forms.js";
import { timeAgo, titleCase } from "../core/format.js";
import { attachmentPicker, openLiveChat } from "../components/support-bits.js";

await initApp();
const view = $("#view");
view.removeAttribute("aria-busy");

const CATEGORIES = ["ACCOUNT", "DEPOSIT", "WITHDRAWAL", "TRADING", "INVESTMENT", "KYC", "SECURITY", "TECHNICAL", "OTHER"];
const PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"];

const OPTION_CLS = "rounded-2xl border border-line bg-panel p-5 text-left transition-colors hover:border-line-strong";
const option = (iconName, title, body, { href, action }) => {
  const inner = html`${icon(iconName, "h-5 w-5 text-accent")}<p class="mt-3 font-semibold text-white">${title}</p><p class="mt-1 text-sm text-muted">${body}</p>`;
  return href ? html`<a href="${href}" class="${OPTION_CLS}">${inner}</a>` : html`<button type="button" data-${raw(action)} class="${OPTION_CLS}">${inner}</button>`;
};

mount(
  view,
  html`${pageHeader({
      title: "Support",
      description: "We're here to help. Never share your password or 2FA codes with anyone, including staff.",
      actions: html`<button type="button" class="btn btn-primary" data-new>${icon("ticket-plus", "h-4 w-4")} New ticket</button>`,
    })}
    <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      ${option("message-circle", "Live chat", "Message our support team in real time.", { action: "chat" })}
      ${option("ticket-plus", "Create support ticket", "Best for account-specific issues with attachments.", { action: "new" })}
      ${option("help-circle", "FAQ", "Quick answers to common questions.", { href: "/faq" })}
      ${option("book-open", "Help center", "Guides on funding, trading and security.", { href: "/help" })}
    </div>
    ${card({ cls: "mt-6", title: "My tickets", body: html`<div class="border-t border-line" data-table></div>` })}`,
);

const table = new DataTable($("[data-table]", view), {
  onRowClick: (t) => (location.href = `/dashboard/support/${t.id}`),
  empty: emptyState({ title: "No tickets yet", description: "Create a ticket and our team will get back to you.", action: html`<button type="button" class="btn btn-primary" data-new>Create ticket</button>` }),
  columns: [
    { key: "n", header: "#", cell: (t) => html`<span class="font-mono text-muted">${t.number}</span>` },
    { key: "s", header: "Subject", cell: (t) => html`<a href="/dashboard/support/${t.id}" class="font-medium text-white hover:text-accent">${t.subject}</a>` },
    { key: "c", header: "Category", hideOnMobile: true, cell: (t) => badge(titleCase(t.category)) },
    { key: "p", header: "Priority", hideOnMobile: true, cell: (t) => html`<span class="text-xs text-muted">${titleCase(t.priority)}</span>` },
    { key: "st", header: "Status", cell: (t) => statusBadge(t.status) },
    { key: "u", header: "Updated", align: "right", cell: (t) => html`<span class="text-xs text-dim">${timeAgo(t.lastMessageAt)}</span>` },
  ],
});
table.set(undefined, { loading: true });
watch("/api/support/tickets", ({ data, error }) => (data ? table.set(data) : error && table.set(undefined, { error })));

function newTicket() {
  const m = openModal({
    title: "Create support ticket",
    size: "lg",
    body: html`<form id="ticket-form" class="space-y-4" novalidate>
      ${field({ name: "subject", label: "Subject", attrs: html`maxlength="140"` })}
      <div class="grid gap-4 sm:grid-cols-2">${selectField({ name: "category", label: "Category", options: CATEGORIES.map((c) => [c, titleCase(c)]), value: "ACCOUNT" })}${selectField({ name: "priority", label: "Priority", options: PRIORITIES.map((c) => [c, titleCase(c)]), value: "NORMAL" })}</div>
      ${textareaField({ name: "message", label: "Message", rows: 6, placeholder: "Describe the issue, including any transaction IDs." })}
      <div data-attach></div>
      <div data-form-error hidden></div>
    </form>`,
    footer: html`<button type="button" class="btn btn-secondary" data-close>Cancel</button><button type="submit" form="ticket-form" class="btn btn-primary">Submit ticket</button>`,
  });
  const form = $("#ticket-form", m.el);
  const picker = attachmentPicker($("[data-attach]", form));
  bindForm(
    form,
    {
      subject: [rules.min(5, "Subject is too short"), rules.max(140)],
      message: [rules.min(10, "Please describe the issue (10+ characters)"), rules.max(5000)],
    },
    async (v) => {
      const big = picker.tooLarge();
      if (big) throw new ApiError("VALIDATION_ERROR", `${big.name} is larger than 8 MB.`, 400);
      const body = new FormData();
      ["subject", "category", "priority", "message"].forEach((k) => body.append(k, String(v[k]).trim()));
      picker.files().forEach((f) => body.append("files", f));
      const res = await api("/api/support/tickets", { form: body, method: "POST" });
      toast.success(`Ticket #${res.number} created`, "We'll reply here and notify you.");
      invalidate("/api/support");
      m.close();
      location.href = `/dashboard/support/${res.id}`;
    },
  );
}

on(view, "click", "[data-new]", newTicket);
on(view, "click", "[data-chat]", openLiveChat);
if (param("chat") === "1") openLiveChat();
