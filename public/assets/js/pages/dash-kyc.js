import { html, $, $$, mount, cx } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { api, ApiError } from "../core/api.js";
import { watch, invalidate } from "../core/store.js";
import { initApp } from "../core/app-shell.js";
import { card, notice, errorState, skeleton, pageHeader, statusBadge, toast } from "../core/ui.js";
import { field, selectField, bindForm, rules } from "../core/forms.js";
import { COUNTRIES } from "../core/countries.js";
import { formatDate, titleCase } from "../core/format.js";

const user = await initApp();
const view = $("#view");
view.removeAttribute("aria-busy");

const DOCS = [
  { key: "GOVERNMENT_ID", label: "Government ID", hint: "Passport, national ID card or driving licence. All corners visible." },
  { key: "PROOF_OF_ADDRESS", label: "Proof of address", hint: "Utility bill or bank statement from the last 3 months." },
  { key: "SELFIE", label: "Selfie", hint: "A clear photo of your face holding your ID." },
];
const MAX_FILE = 8 * 1024 * 1024;

mount(
  view,
  html`${pageHeader({ title: "Identity verification", description: "Required for some account features. Your documents are stored privately and reviewed by our compliance team." })}
    <div class="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_1.4fr]">
      <div class="space-y-6">
        <section class="card"><div class="card-body pt-5" data-status>${skeleton("h-28 w-full")}</div></section>
        ${card({ title: "When is verification required?", body: html`<div class="card-body space-y-2 text-sm" data-reqs>${skeleton("h-20 w-full")}</div>` })}
        <div data-docs></div>
      </div>
      <section class="card" data-form-card><div class="card-body">${skeleton("h-96 w-full")}</div></section>
    </div>`,
);

const STATUS_UI = {
  APPROVED: ["badge-check", "border-up/30 bg-up-soft text-up"],
  PENDING: ["clock", "border-info/30 bg-info-soft text-info"],
  REJECTED: ["x-circle", "border-down/30 bg-down-soft text-down"],
  NOT_STARTED: ["shield-check", "border-line-strong bg-panel-3 text-muted"],
};

function fileDrop(d) {
  return html`<label class="flex cursor-pointer flex-col gap-2 rounded-xl border border-dashed border-line-strong bg-base-2 p-4 transition-colors hover:border-accent/50" data-drop="${d.key}">
    <span class="flex items-center justify-between"><span class="text-sm font-semibold text-white">${d.label}</span><span data-drop-icon>${icon("upload", "h-4 w-4 text-dim")}</span></span>
    <span class="text-xs text-dim" data-drop-text>${d.hint}</span>
    <input type="file" name="${d.key}" accept="image/jpeg,image/png,image/webp,application/pdf" class="sr-only" />
  </label>`;
}

let rendered = null;
watch("/api/users/me/kyc", ({ data, error }) => {
  if (!data) return error && mount(view, errorState({ message: error.message }));
  const [iconName, tone] = STATUS_UI[data.status] ?? STATUS_UI.NOT_STARTED;
  const message = {
    APPROVED: "Your identity has been verified.",
    PENDING: `Submitted ${formatDate(data.application?.submittedAt)}. Reviews are completed by our compliance team.`,
    REJECTED: data.application?.rejectionReason ?? "Your previous submission was not approved.",
    NOT_STARTED: "You haven't submitted verification documents yet.",
  }[data.status];
  mount(
    $("[data-status]", view),
    html`<div class="flex items-start gap-4"><span class="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border ${tone}">${icon(iconName, "h-6 w-6")}</span><div><p class="text-xs text-dim">Verification status</p><div class="mt-1">${statusBadge(data.status)}</div><p class="mt-2 text-sm text-muted">${message}</p></div></div>`,
  );
  const r = data.requirements;
  mount(
    $("[data-reqs]", view),
    html`${[
      ["Deposits", r.requiredForDeposit],
      ["Withdrawals", r.requiredForWithdrawal],
      ["Investment plans", r.requiredForInvestments],
    ].map(([k, v]) => html`<div class="flex justify-between border-b border-line/60 pb-2 last:border-0"><span class="text-muted">${k}</span><span class="${v ? "text-warn" : "text-dim"}">${v ? "Required" : "Not required"}</span></div>`)}
    <p class="pt-2 text-xs text-dim">Requirements are set by HarborFinance compliance and may change.</p>`,
  );
  mount(
    $("[data-docs]", view),
    data.application?.documents.length ? card({ title: "Submitted documents", body: html`<div class="card-body space-y-2 text-sm">${data.application.documents.map((d) => html`<div class="flex items-center gap-2 text-muted">${icon("file-up", "h-4 w-4 text-dim")} ${titleCase(d.type)} — ${d.fileName}</div>`)}</div>` }) : "",
  );

  // Only re-render the form when the status changes, so typing isn't lost on refresh.
  const key = `${data.status}:${r.selfieRequired}`;
  if (rendered === key) return;
  rendered = key;
  const canSubmit = data.status === "NOT_STARTED" || data.status === "REJECTED";
  const formCard = $("[data-form-card]", view);
  if (!canSubmit) {
    mount(formCard, html`<div class="card-header"><h3 class="card-title">Verification details</h3></div><div class="card-body"><p class="text-sm text-muted">${data.status === "APPROVED" ? "No further action is needed." : "You'll be notified when the review is complete. You can't edit a submission while it's under review."}</p></div>`);
    return;
  }
  const docs = DOCS.filter((d) => d.key !== "SELFIE" || r.selfieRequired);
  mount(
    formCard,
    html`<div class="card-header"><div><h3 class="card-title">Submit your details</h3><p class="card-desc">Use your legal name exactly as it appears on your ID.</p></div></div>
    <div class="card-body">${
      !user.emailVerified
        ? notice("warn", { body: "Verify your email address before submitting identity documents." })
        : html`<form id="kyc-form" class="space-y-4" novalidate>
            ${field({ name: "fullName", label: "Full legal name", value: `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim(), autocomplete: "name" })}
            <div class="grid gap-4 sm:grid-cols-2">${field({ name: "dateOfBirth", label: "Date of birth", type: "date", autocomplete: "bday" })}${selectField({ name: "country", label: "Country", options: COUNTRIES, value: user.country })}</div>
            ${field({ name: "addressLine", label: "Residential address", autocomplete: "street-address" })}
            <div class="grid gap-4 sm:grid-cols-2">${field({ name: "city", label: "City", autocomplete: "address-level2" })}${field({ name: "postalCode", label: "Postal code", autocomplete: "postal-code" })}</div>
            <div class="grid gap-4 sm:grid-cols-2">${selectField({ name: "idType", label: "ID type", options: [["PASSPORT", "Passport"], ["NATIONAL_ID", "National ID card"], ["DRIVERS_LICENSE", "Driving licence"]], value: "PASSPORT" })}${field({ name: "idNumber", label: "ID number", hint: "Encrypted at rest", autocomplete: "off" })}</div>
            <div class="grid gap-3 sm:grid-cols-2">${docs.map(fileDrop)}</div>
            <p class="text-xs text-dim">JPG, PNG, WEBP or PDF up to 8 MB each. Files are checked for type and stored in private storage.</p>
            <div data-form-error hidden></div>
            <button type="submit" class="btn btn-primary btn-lg w-full">Submit for review</button>
          </form>`
    }</div>`,
  );
  const form = $("#kyc-form", formCard);
  if (!form) return;

  form.addEventListener("change", (e) => {
    const input = e.target;
    if (input.type !== "file") return;
    const drop = input.closest("[data-drop]");
    const f = input.files?.[0];
    const d = DOCS.find((x) => x.key === drop.dataset.drop);
    drop.className = cx("flex cursor-pointer flex-col gap-2 rounded-xl border border-dashed p-4 transition-colors hover:border-accent/50", f ? "border-up/40 bg-up-soft/40" : "border-line-strong bg-base-2");
    mount($("[data-drop-icon]", drop), f ? icon("badge-check", "h-4 w-4 text-up") : icon("upload", "h-4 w-4 text-dim"));
    $("[data-drop-text]", drop).textContent = f ? `${f.name} · ${(f.size / 1024 / 1024).toFixed(2)} MB` : d.hint;
  });

  bindForm(
    form,
    {
      fullName: [rules.min(3, "Enter your full legal name")],
      dateOfBirth: [rules.pattern(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"), rules.required("Date of birth")],
      country: [rules.required("Country")],
      addressLine: [rules.min(3, "Enter your residential address")],
      city: [rules.min(2, "Enter your city")],
      postalCode: [rules.min(2, "Enter your postal code")],
      idNumber: [rules.min(4, "Enter your ID number")],
    },
    async (values) => {
      const inputs = $$("input[type=file]", form);
      const missing = inputs.find((i) => !i.files?.length);
      if (missing) throw new ApiError("VALIDATION_ERROR", `Please upload your ${DOCS.find((d) => d.key === missing.name).label.toLowerCase()}.`, 400);
      const big = inputs.map((i) => i.files[0]).find((f) => f.size > MAX_FILE);
      if (big) throw new ApiError("VALIDATION_ERROR", `${big.name} is larger than 8 MB.`, 400);
      const body = new FormData();
      Object.entries(values).forEach(([k, v]) => body.append(k, String(v).trim()));
      inputs.forEach((i) => body.append(i.name, i.files[0]));
      await api("/api/users/me/kyc", { form: body, method: "POST" });
      toast.success("Verification submitted", "We'll notify you once it has been reviewed.");
      invalidate("/api/users/me");
    },
  );
});
