import { html, $, on, mount, cx } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { api } from "../core/api.js";
import { watch, invalidate } from "../core/store.js";
import { initApp } from "../core/app-shell.js";
import { badge, notice, errorState, skeleton, statusBadge, toast, confirmDialog, withBusy } from "../core/ui.js";
import { formatDate, titleCase } from "../core/format.js";
import { attachmentPicker } from "../components/support-bits.js";

await initApp();
const view = $("#view");
view.removeAttribute("aria-busy");
const id = location.pathname.split("/").pop();
const key = `/api/support/tickets/${id}`;

mount(
  view,
  html`<div class="mx-auto max-w-3xl space-y-5">
    <a href="/dashboard/support" class="inline-flex items-center gap-1.5 text-sm text-muted hover:text-white">${icon("arrow-left", "h-4 w-4")} All tickets</a>
    <div data-head>${skeleton("h-20 w-full")}</div>
    <div class="space-y-3" data-messages>${skeleton("h-40 w-full")}</div>
    <div data-reply></div>
  </div>`,
);

let replyStatus = null;
let picker = null;

function drawReply(status) {
  if (replyStatus === status) return;
  const wasClosed = replyStatus === "CLOSED";
  replyStatus = status;
  const el = $("[data-reply]", view);
  if (status === "CLOSED") return mount(el, notice("info", { iconName: "info", body: "This ticket is closed. Open a new ticket if you need more help." }));
  if (picker && !wasClosed) return;
  mount(
    el,
    html`<form class="card p-4" data-reply-form novalidate>
      <textarea name="body" rows="4" class="textarea" placeholder="Write a reply…" aria-label="Reply" maxlength="5000"></textarea>
      <div class="mt-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div data-attach></div><button type="submit" class="btn btn-primary">Send reply</button></div>
      <p class="mt-2 text-xs text-down" data-err hidden></p>
    </form>`,
  );
  picker = attachmentPicker($("[data-attach]", el));
}

watch(
  key,
  ({ data, error }) => {
    if (!data) return error && mount(view, errorState({ message: error.code === "NOT_FOUND" ? "This ticket doesn't exist." : error.message, retry: error.code !== "NOT_FOUND" }));
    document.title = `Ticket #${data.number} · HarborFinance`;
    mount(
      $("[data-head]", view),
      html`<div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div><p class="font-mono text-xs text-dim">Ticket #${data.number}</p><h1 class="mt-1 font-display text-2xl font-extrabold text-white">${data.subject}</h1>
          <div class="mt-2 flex flex-wrap gap-2">${statusBadge(data.status)}${badge(titleCase(data.category))}${badge(`${titleCase(data.priority)} priority`)}</div></div>
        ${data.status !== "CLOSED" ? html`<button type="button" class="btn btn-secondary btn-sm" data-close-ticket>Close ticket</button>` : ""}
      </div>`,
    );
    mount(
      $("[data-messages]", view),
      data.messages.map(
        (m) => html`<article class="${cx("card p-4", m.isStaff && "border-accent/25")}">
          <div class="flex items-center justify-between text-xs"><span class="${cx("font-semibold", m.isStaff ? "text-accent" : "text-white")}">${m.authorName}</span><span class="text-dim">${formatDate(m.createdAt)}</span></div>
          <p class="mt-2 text-sm leading-relaxed whitespace-pre-wrap text-fg">${m.body}</p>
          ${m.attachments?.length ? html`<div class="mt-3 flex flex-wrap gap-2">${m.attachments.map((a) => html`<a href="/api/files?key=${encodeURIComponent(a.key)}" target="_blank" rel="noopener" class="inline-flex items-center gap-1.5 rounded-md bg-panel-2 px-2 py-1 text-xs text-muted hover:text-white">${icon("paperclip", "h-3 w-3")} ${a.name}</a>`)}</div>` : ""}
        </article>`,
      ),
    );
    drawReply(data.status);
  },
  { refresh: 15000 },
);

on(view, "submit", "[data-reply-form]", async (e, form) => {
  e.preventDefault();
  const err = $("[data-err]", form);
  const text = form.body.value.trim();
  err.hidden = true;
  const fail = (msg) => {
    err.textContent = msg;
    err.hidden = false;
  };
  if (!text) return fail("Write a message first.");
  const big = picker.tooLarge();
  if (big) return fail(`${big.name} is larger than 8 MB.`);
  const body = new FormData();
  body.append("body", text);
  picker.files().forEach((f) => body.append("files", f));
  try {
    await withBusy(form.querySelector("[type=submit]"), () => api(key, { form: body, method: "POST" }));
    form.body.value = "";
    picker.clear();
    invalidate("/api/support");
  } catch (ex) {
    fail(ex.message ?? "Message not sent.");
  }
});

on(view, "click", "[data-close-ticket]", async () => {
  if (!(await confirmDialog({ title: "Close this ticket?", message: "You can open a new ticket at any time if you need more help.", confirmLabel: "Close ticket" }))) return;
  try {
    await api(key, { method: "PATCH", body: { status: "CLOSED" } });
    toast.success("Ticket closed");
    invalidate("/api/support");
  } catch (ex) {
    toast.error("Could not close ticket", ex.message);
  }
});
