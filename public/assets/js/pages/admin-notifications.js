import { html, $, on, mount } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { api } from "../core/api.js";
import { watch, invalidate } from "../core/store.js";
import { card, pageHeader, segmented, emptyState, skeleton, toast } from "../core/ui.js";
import { field, textareaField, bindForm, rules } from "../core/forms.js";
import { formatDate } from "../core/format.js";
import { adminPage } from "../components/admin-kit.js";

const { view } = await adminPage();
let audience = "all";

mount(
  view,
  html`${pageHeader({ title: "Notifications", description: "Send system announcements to all users or a message to a single account." })}
    <div class="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_1.2fr]">
      ${card({
        title: "Compose",
        body: html`<form id="notify-form" class="card-body space-y-4" novalidate>
          <div data-audience></div>
          <div data-email hidden>${field({ name: "email", label: "User email", type: "email" })}</div>
          ${field({ name: "title", label: "Title", attrs: html`maxlength="120"` })}
          ${textareaField({ name: "body", label: "Message", rows: 4 })}
          ${field({ name: "link", label: "Link (optional)", hint: "Relative path, e.g. /dashboard/deposit" })}
          <div data-form-error hidden></div>
          <button type="submit" class="btn btn-primary">${icon("send", "h-4 w-4")} Send notification</button>
        </form>`,
      })}
      ${card({ title: "Recently sent", body: html`<div class="card-body space-y-3" data-history>${skeleton("h-40 w-full")}</div>` })}
    </div>`,
);

const form = $("#notify-form", view);
const drawAudience = () => {
  mount(
    $("[data-audience]", form),
    segmented(
      [
        { value: "all", label: "All active users" },
        { value: "user", label: "Single user" },
      ],
      audience,
      { name: "aud" },
    ),
  );
  $("[data-email]", form).hidden = audience !== "user";
};
drawAudience();
on(form, "click", "[data-aud]", (_e, b) => {
  audience = b.dataset.aud;
  drawAudience();
});

bindForm(
  form,
  () => ({
    email: audience === "user" ? [rules.required("User email"), rules.email()] : [],
    title: [rules.min(3, "Enter a title")],
    body: [rules.min(3, "Enter a message")],
    link: [rules.optional(rules.pattern(/^\/(?!\/)[\w\-/?=&.%]*$/, "Use a relative path starting with /"))],
  }),
  async (v) => {
    const res = await api("/api/admin/notifications", { body: { audience, email: audience === "user" ? v.email : undefined, title: v.title.trim(), body: v.body.trim(), link: v.link || undefined } });
    toast.success("Notification sent", `${res.recipients} recipient(s)`);
    ["title", "body", "link"].forEach((k) => (form[k].value = ""));
    invalidate("/api/admin/notifications");
  },
);

watch("/api/admin/notifications", ({ data }) => {
  if (!data) return;
  mount(
    $("[data-history]", view),
    !data.length
      ? emptyState({ iconName: "megaphone", title: "Nothing sent yet" })
      : data.map(
          (h) => html`<div class="rounded-xl border border-line p-3">
            <div class="flex justify-between text-xs text-dim"><span>${h.action === "notification.broadcast" ? `Broadcast · ${h.metadata.recipients} users` : `To ${h.metadata.email}`}</span><span>${formatDate(h.createdAt)}</span></div>
            <p class="mt-1 font-semibold text-white">${h.metadata.title}</p><p class="text-sm text-muted">${h.metadata.body}</p><p class="mt-1 text-[11px] text-dim">by ${h.actorEmail}</p>
          </div>`,
        ),
  );
});
