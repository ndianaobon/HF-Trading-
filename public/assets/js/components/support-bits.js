// Support UI shared by the support list and ticket thread: attachment picker
// and the live chat panel.

import { html, $, on, mount, cx } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { api } from "../core/api.js";
import { watch, invalidate } from "../core/store.js";
import { formatDate } from "../core/format.js";

const MAX_FILES = 3;
const MAX_SIZE = 8 * 1024 * 1024;

/** Mounts an attachment picker into `el`; returns { files(), clear() }. */
export function attachmentPicker(el) {
  let files = [];
  const draw = () =>
    mount(
      el,
      html`<label class="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-line-strong px-3 py-2 text-xs font-semibold text-muted hover:text-white">${icon("paperclip", "h-3.5 w-3.5")} Attach files<input type="file" multiple accept="image/jpeg,image/png,image/webp,application/pdf" class="sr-only" data-files /></label>
      ${files.length ? html`<ul class="mt-2 space-y-1">${files.map((f, i) => html`<li class="flex items-center justify-between gap-2 rounded-md bg-panel-2 px-2 py-1 text-xs text-muted"><span class="truncate">${f.name}</span><button type="button" data-remove="${i}" aria-label="Remove ${f.name}">${icon("x", "h-3.5 w-3.5")}</button></li>`)}</ul>` : ""}
      <p class="mt-1 text-[11px] text-dim">Up to ${MAX_FILES} files · JPG, PNG, WEBP or PDF · 8 MB each</p>`,
    );
  el.addEventListener("change", (e) => {
    if (!e.target.matches("[data-files]")) return;
    files = [...files, ...Array.from(e.target.files ?? [])].slice(0, MAX_FILES);
    draw();
  });
  on(el, "click", "[data-remove]", (_e, b) => {
    files = files.filter((_, i) => i !== Number(b.dataset.remove));
    draw();
  });
  draw();
  return {
    files: () => files,
    tooLarge: () => files.find((f) => f.size > MAX_SIZE),
    clear: () => {
      files = [];
      draw();
    },
  };
}

let chatEl = null;

/** Opens the live chat panel (a support thread staff answer from the admin console). */
export function openLiveChat() {
  if (chatEl) return;
  chatEl = document.createElement("div");
  chatEl.className = "fixed right-0 bottom-0 z-[80] flex h-[min(620px,85dvh)] w-full animate-slide-up flex-col border border-line-strong bg-panel shadow-[var(--shadow-pop)] sm:right-6 sm:bottom-6 sm:w-[380px] sm:rounded-2xl";
  chatEl.setAttribute("role", "dialog");
  chatEl.setAttribute("aria-label", "Live chat");
  chatEl.innerHTML = String(html`<div class="flex items-center justify-between border-b border-line px-4 py-3">
      <div class="flex items-center gap-2"><span class="grid h-8 w-8 place-items-center rounded-lg bg-accent-soft text-accent">${icon("message-circle", "h-4 w-4")}</span><div><p class="text-sm font-semibold text-white">HarborFinance Support</p><p class="text-[11px] text-dim" data-hours>Connecting…</p></div></div>
      <button type="button" data-close-chat class="grid h-8 w-8 place-items-center rounded-lg text-dim hover:bg-panel-2 hover:text-white" aria-label="Close chat">${icon("x", "h-4 w-4")}</button>
    </div>
    <div class="flex-1 space-y-3 overflow-y-auto px-4 py-4" data-messages aria-live="polite"></div>
    <form class="border-t border-line p-3" data-chat-form>
      <p class="mb-2 text-xs text-down" data-chat-error hidden></p>
      <div class="flex gap-2"><input name="body" maxlength="5000" placeholder="Type a message…" aria-label="Message" autocomplete="off" class="input h-10 flex-1" /><button type="submit" class="grid h-10 w-10 place-items-center rounded-lg bg-accent text-accent-ink disabled:opacity-50" aria-label="Send">${icon("send", "h-4 w-4")}</button></div>
    </form>`);
  document.body.appendChild(chatEl);
  const list = $("[data-messages]", chatEl);
  const form = $("[data-chat-form]", chatEl);
  let count = -1;

  const unsub = watch(
    "/api/support/chat",
    ({ data }) => {
      if (!data || !chatEl) return;
      $("[data-hours]", chatEl).textContent = data.enabled === false ? "Offline" : data.hours ? `Hours: ${data.hours}` : "We reply as soon as an agent is available";
      form.body.disabled = data.enabled === false;
      form.body.placeholder = data.enabled === false ? "Chat is offline — please open a ticket" : "Type a message…";
      mount(
        list,
        html`<div class="max-w-[85%] rounded-2xl rounded-tl-sm bg-panel-3 px-3 py-2 text-sm text-fg">Hi! Describe what you need help with and a member of our team will reply here. Never share your password or 2FA codes.</div>
        ${data.messages.map(
          (m) => html`<div class="${cx("flex flex-col", m.isStaff ? "items-start" : "items-end")}"><div class="${cx("max-w-[85%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap", m.isStaff ? "rounded-tl-sm bg-panel-3 text-fg" : "rounded-tr-sm bg-accent text-accent-ink")}">${m.body}</div><span class="mt-1 text-[10px] text-dim">${m.isStaff ? "Support · " : ""}${formatDate(m.createdAt, "time")}</span></div>`,
        )}`,
      );
      if (data.messages.length !== count) {
        count = data.messages.length;
        list.scrollTop = list.scrollHeight;
      }
    },
    { refresh: 5000 },
  );

  const close = () => {
    unsub();
    chatEl?.remove();
    chatEl = null;
    document.removeEventListener("keydown", onKey);
  };
  const onKey = (e) => e.key === "Escape" && close();
  document.addEventListener("keydown", onKey);
  $("[data-close-chat]", chatEl).addEventListener("click", close);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = form.body.value.trim();
    if (!text) return;
    const btn = form.querySelector("[type=submit]");
    const err = $("[data-chat-error]", form);
    btn.disabled = true;
    err.hidden = true;
    try {
      await api("/api/support/chat", { body: { body: text } });
      form.body.value = "";
      invalidate("/api/support/chat");
    } catch (ex) {
      err.textContent = ex.message ?? "Message not sent.";
      err.hidden = false;
    } finally {
      btn.disabled = false;
    }
  });
  setTimeout(() => form.body.focus(), 50);
}
