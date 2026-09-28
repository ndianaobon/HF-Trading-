import { html, raw, $, on, mount, cx, param } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { api } from "../core/api.js";
import { watch, invalidate } from "../core/store.js";
import { pageHeader, statusBadge, badge, emptyState, errorState, skeleton, toast, openModal } from "../core/ui.js";
import { formatDate, timeAgo, titleCase } from "../core/format.js";
import { adminPage, adminTable } from "../components/admin-kit.js";
import { attachmentList, attachmentPicker, editedLabel } from "../components/support-bits.js";

const { user: admin, view } = await adminPage();
const canReply = admin.can("support.reply");
const STATUSES = ["OPEN", "IN_PROGRESS", "WAITING_FOR_USER", "RESOLVED", "CLOSED"];
let selected = param("ticket");

mount(
  view,
  html`${pageHeader({ title: "Support", description: "Tickets and live chat conversations." })}
    <div class="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_1.1fr]">
      <div data-list></div>
      <section class="card flex min-h-[520px] flex-col" data-detail>${emptyState({ title: "Select a ticket", description: "Choose a ticket to read and reply.", cls: "flex-1" })}</section>
    </div>`,
);

const list = adminTable($("[data-list]", view), {
  endpoint: "/api/admin/support",
  pageSize: 20,
  filters: [
    { name: "status", type: "select", default: "OPEN", options: [...STATUSES.map((s) => [s, titleCase(s)]), ["", "All"]] },
    { name: "q", type: "search", placeholder: "Search subject or email", cls: "sm:w-64" },
  ],
  onRowClick: (t) => select(t.id),
  rowClass: (t) => (t.id === selected ? "bg-panel-2" : ""),
  empty: emptyState({ title: "No tickets" }),
  columns: [
    {
      key: "s",
      header: "Conversation",
      cell: (t) =>
        html`<div><p class="flex items-center gap-2 font-medium text-white">${t.category === "LIVE_CHAT" ? badge("Live chat", "accent") : html`<span class="text-dim">#${t.number}</span>`} ${t.subject}</p><p class="text-xs text-dim">${t.user.email}${["OPEN", "IN_PROGRESS"].includes(t.status) ? html` · <span class="font-semibold text-warn">waiting ${timeAgo(t.lastMessageAt).replace(" ago", "")}</span>` : ""}</p></div>`,
    },
    { key: "p", header: "Priority", cell: (t) => badge(titleCase(t.priority), t.priority === "URGENT" ? "down" : t.priority === "HIGH" ? "warn" : "neutral") },
    { key: "st", header: "Status", cell: (t) => statusBadge(t.status) },
    { key: "u", header: "Updated", align: "right", cell: (t) => html`<span class="text-xs text-dim">${timeAgo(t.lastMessageAt)}</span>` },
  ],
});

const detail = $("[data-detail]", view);
let unsub = null;
let draft = "";
let picker = null;
let pendingFiles = [];

function select(id) {
  selected = id;
  history.replaceState(null, "", `/admin/support?ticket=${id}`);
  list.reload();
  unsub?.();
  mount(detail, skeleton("m-5 h-96"));
  unsub = watch(
    `/api/admin/support/${id}`,
    ({ data: d, error }) => {
      if (!d) return error && mount(detail, errorState({ message: error.message }));
      const typing = $("[data-reply] textarea", detail);
      if (typing) draft = typing.value;
      const sel = (name, value, opts, cls) => html`<select class="select h-8 text-xs ${cls}" aria-label="${titleCase(name)}" data-patch="${name}">${opts.map((s) => html`<option value="${s}" ${s === value ? raw("selected") : ""}>${titleCase(s)}</option>`)}</select>`;
      mount(
        detail,
        html`<div class="border-b border-line p-5">
          <p class="font-mono text-xs text-dim">#${d.number} · ${titleCase(d.category)}</p>
          <h2 class="font-display text-lg font-bold text-white">${d.subject}</h2>
          <p class="text-sm text-muted"><a href="/admin/users/${d.user.id}" class="hover:text-accent">${d.user.email}</a> · assigned to ${d.assignedTo?.email ?? "nobody"}</p>
          ${canReply ? html`<div class="mt-3 flex flex-wrap gap-2">${sel("status", d.status, STATUSES, "w-44")}${sel("priority", d.priority, ["LOW", "NORMAL", "HIGH", "URGENT"], "w-32")}${!d.assignedTo ? html`<button type="button" class="btn btn-secondary btn-sm" data-assign>Assign to me</button>` : ""}</div>` : ""}
        </div>
        <div class="flex-1 space-y-3 overflow-y-auto p-5" style="max-height:460px" data-thread>
          ${!d.messages.length ? html`<p class="text-sm text-dim">No messages yet.</p>` : ""}
          ${d.messages.map(
            (m) => html`<div class="${cx("rounded-xl border p-3", m.isStaff ? "border-accent/25 bg-accent/[0.04]" : "border-line bg-base-2")}">
              <div class="flex items-center justify-between gap-2 text-xs"><span class="${m.isStaff ? "font-semibold text-accent" : "font-semibold text-white"}">${m.isStaff ? `${m.author.email} (staff)` : m.author.email}</span><span class="flex items-center gap-2 text-dim">${editedLabel(m)} ${formatDate(m.createdAt)}${m.isStaff && canReply ? html`<button type="button" class="font-semibold text-accent hover:text-accent-strong" data-edit-msg="${m.id}">Edit</button>` : ""}</span></div>
              ${m.body ? html`<p class="mt-1.5 text-sm whitespace-pre-wrap text-fg" data-body="${m.id}">${m.body}</p>` : ""}
              ${attachmentList(m.attachments)}
            </div>`,
          )}
        </div>
        ${canReply ? html`<form class="border-t border-line p-4" data-reply novalidate><textarea rows="3" class="textarea" placeholder="Write a reply… Never ask users for passwords or 2FA codes." aria-label="Reply" maxlength="5000"></textarea><div class="mt-2 flex flex-wrap items-start justify-between gap-2"><div data-attach></div><button type="submit" class="btn btn-primary">${icon("send", "h-4 w-4")} Send reply</button></div></form>` : ""}`,
      );
      const ta = $("[data-reply] textarea", detail);
      if (ta) ta.value = draft;
      const attachEl = $("[data-attach]", detail);
      if (attachEl) picker = attachmentPicker(attachEl, { initial: pendingFiles, onChange: (f) => (pendingFiles = f) });
      const thread = $("[data-thread]", detail);
      thread.scrollTop = thread.scrollHeight;
    },
    { refresh: 10000 },
  );
}

const patch = async (body) => {
  try {
    await api(`/api/admin/support/${selected}`, { method: "PATCH", body });
    toast.success("Ticket updated");
  } catch (err) {
    toast.error("Update failed", err.message);
  }
  invalidate("/api/admin/support");
};
on(detail, "change", "[data-patch]", (_e, s) => patch({ [s.dataset.patch]: s.value }));
on(detail, "click", "[data-assign]", () => patch({ assignToMe: true }));
on(detail, "click", "[data-edit-msg]", (_e, b) => {
  const id = b.dataset.editMsg;
  const current = $(`[data-body="${id}"]`, detail)?.textContent ?? "";
  const m = openModal({
    title: "Edit reply",
    description: "The customer sees the updated text marked as edited. The original stays in the audit log.",
    body: html`<textarea rows="6" class="textarea" maxlength="5000" data-edit-text aria-label="Reply text">${current}</textarea><div data-edit-err></div>`,
    footer: html`<button type="button" class="btn btn-secondary" data-close>Cancel</button><button type="button" class="btn btn-primary" data-save-edit>Save changes</button>`,
  });
  $("[data-save-edit]", m.el).addEventListener("click", async (ev) => {
    const text = $("[data-edit-text]", m.el).value.trim();
    if (!text) return;
    ev.currentTarget.disabled = true;
    try {
      await api(`/api/admin/support/messages/${id}`, { method: "PATCH", body: { body: text } });
      toast.success("Reply updated");
      m.close();
      invalidate("/api/admin/support");
    } catch (err) {
      ev.currentTarget.disabled = false;
      toast.error("Could not update", err.message);
    }
  });
});

on(detail, "submit", "[data-reply]", async (e, form) => {
  e.preventDefault();
  const ta = $("textarea", form);
  const body = ta.value.trim();
  const files = picker?.files() ?? [];
  if (!body && !files.length) return;
  if (picker?.tooLarge()) return toast.error("File too large", "Each file must be 8 MB or smaller.");
  const btn = $("[type=submit]", form);
  btn.disabled = true;
  try {
    if (files.length) {
      const fd = new FormData();
      fd.append("body", body);
      files.forEach((f) => fd.append("files", f));
      await api(`/api/admin/support/${selected}`, { form: fd });
    } else {
      await api(`/api/admin/support/${selected}`, { body: { body } });
    }
    ta.value = "";
    draft = "";
    picker?.clear();
    pendingFiles = [];
    invalidate("/api/admin/support");
  } catch (err) {
    toast.error("Reply failed", err.message);
  } finally {
    btn.disabled = false;
  }
});

if (selected) select(selected);
