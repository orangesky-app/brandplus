"use client";
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  FileText, Plus, X, ChevronUp, ChevronDown, ChevronRight, Download, Save, Trash2,
  Palette, ImageIcon, RefreshCw, Check, Search, Table2, Eraser,
} from "lucide-react";
import {
  REPORT_GROUPS, ITEM_BY_ID, sourcesFor, normalizeItemIds, buildReportSections,
  ReportCtx, ReportSource, ReportItem,
} from "@/lib/report-blocks";
import { exportToPDF } from "@/lib/export";
import { getPresetRange, formatDateSpan, DatePreset } from "@/lib/date-range-context";

interface Branding { brandName: string; color: string; clientName: string; logoDataUrl: string; reportTitle: string }
interface Template { id: string; name: string; blocks: string[]; branding: Partial<Branding> }

const SOURCE_ENDPOINT: Record<Exclude<ReportSource, "ai">, string> = {
  shopify:    "/api/shopify/sales",
  dashboard:  "/api/shopify/dashboard",
  customers:  "/api/shopify/customers/period",
  meta:       "/api/meta",
  placement:  "/api/meta/placement",
  gads:       "/api/google/ads",
  ga4:        "/api/ga4?organic=1",
  gsc:        "/api/gsc",
};

const PRESETS: { id: DatePreset; label: string }[] = [
  { id: "today", label: "Today" }, { id: "yesterday", label: "Yesterday" },
  { id: "7d", label: "Last 7 days" }, { id: "28d", label: "Last 28 days" },
  { id: "this_month", label: "This month" }, { id: "last_month", label: "Last month" },
  { id: "custom", label: "Custom" },
];

export default function ReportBuilderPage() {
  const [selected, setSelected] = useState<string[]>([]);
  const [preset, setPreset] = useState<DatePreset>("this_month");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [branding, setBranding] = useState<Branding>({ brandName: "", color: "#F97316", clientName: "", logoDataUrl: "", reportTitle: "Performance Report" });
  const [showBranding, setShowBranding] = useState(false);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [templateName, setTemplateName] = useState("");
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<string[]>([]);

  useEffect(() => { loadTemplates(); }, []);
  const flash = (kind: "ok" | "err", text: string) => { setMsg({ kind, text }); setTimeout(() => setMsg(null), 3500); };

  async function loadTemplates() {
    try {
      const res = await fetch("/api/reports/templates");
      if (res.ok) { const d = await res.json() as { templates: Template[] }; setTemplates(d.templates ?? []); }
    } catch { /* ignore */ }
  }

  const toggle = (id: string) =>
    setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  // Select / clear a whole section (or group) in one click; adds in catalog order.
  const setMany = (ids: string[], on: boolean) =>
    setSelected(prev => on ? [...prev, ...ids.filter(id => !prev.includes(id))] : prev.filter(x => !ids.includes(x)));
  const toggleGroup = (id: string) =>
    setCollapsed(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  const q = query.trim().toLowerCase();
  const matches = (item: ReportItem, groupLabel: string, sectionLabel: string) =>
    !q || `${item.label} ${groupLabel} ${sectionLabel}`.toLowerCase().includes(q);
  const move = (id: string, dir: -1 | 1) =>
    setSelected(prev => {
      const i = prev.indexOf(id); const j = i + dir;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev]; [next[i], next[j]] = [next[j], next[i]]; return next;
    });

  function resolveRange() {
    if (preset === "custom") {
      if (!customFrom || !customTo) return null;
      // Picked back to front, the APIs would return nothing, so put them in order.
      const [from, to] = customFrom <= customTo ? [customFrom, customTo] : [customTo, customFrom];
      return { from, to, label: "Custom dates" };
    }
    return getPresetRange(preset);
  }

  function onLogo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setBranding(b => ({ ...b, logoDataUrl: String(reader.result) }));
    reader.readAsDataURL(file);
  }

  async function generate() {
    if (selected.length === 0) { flash("err", "Select at least one KPI or table."); return; }
    const range = resolveRange();
    if (!range) { flash("err", "Pick custom start and end dates."); return; }

    setGenerating(true);
    try {
      const needed = sourcesFor(selected);
      const dataSources = needed.filter(s => s !== "ai") as Exclude<ReportSource, "ai">[];
      const qs = `from=${range.from}&to=${range.to}`;

      const entries = await Promise.all(dataSources.map(async (s) => {
        try {
          const endpoint = SOURCE_ENDPOINT[s];
          const res = await fetch(`${endpoint}${endpoint.includes("?") ? "&" : "?"}${qs}`);
          return [s, res.ok ? await res.json() : null] as const;
        } catch { return [s, null] as const; }
      }));
      const ctx: ReportCtx = Object.fromEntries(entries);

      if (needed.includes("ai")) {
        try {
          const res = await fetch("/api/ai/report", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              shopify: ctx.shopify ?? null, meta: ctx.meta ?? null,
              gsc: ctx.gsc ?? null, ga4: ctx.ga4 ?? null, gads: ctx.gads ?? null,
              period: { from: range.from, to: range.to },
            }),
          });
          if (res.ok) { const d = await res.json() as { report?: unknown }; ctx.ai = d.report ?? null; }
        } catch { /* AI optional */ }
      }

      const sections = buildReportSections(selected, ctx);

      if (sections.length === 0) {
        flash("err", "No data for the selected items in this period (is the platform connected?).");
        setGenerating(false); return;
      }

      const title = branding.reportTitle.trim() || "Performance Report";
      const subtitle = `${branding.clientName ? branding.clientName + " · " : ""}${range.label} (${formatDateSpan(range.from, range.to)})`;
      const fileBase = `${title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${range.from}`;
      await exportToPDF(fileBase, title, subtitle, sections, {
        brandName: branding.brandName, color: branding.color, logoDataUrl: branding.logoDataUrl || undefined,
      });
      flash("ok", "Report generated.");
    } catch {
      flash("err", "Could not generate the report. Please try again.");
    }
    setGenerating(false);
  }

  async function saveTemplate() {
    if (!templateName.trim()) { flash("err", "Name your template first."); return; }
    if (selected.length === 0) { flash("err", "Select at least one KPI or table."); return; }
    setSaving(true);
    try {
      const res = await fetch("/api/reports/templates", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: templateName.trim(), blocks: selected, branding }),
      });
      if (res.ok) { setTemplateName(""); await loadTemplates(); flash("ok", "Template saved."); }
      else { const d = await res.json(); flash("err", d.error ?? "Could not save."); }
    } catch { flash("err", "Could not save template."); }
    setSaving(false);
  }

  function loadTemplate(t: Template) {
    setSelected(normalizeItemIds(t.blocks));
    setBranding(b => ({ ...b, ...t.branding }));
    flash("ok", `Loaded "${t.name}".`);
  }

  async function deleteTemplate(id: string) {
    try { await fetch(`/api/reports/templates?id=${id}`, { method: "DELETE" }); await loadTemplates(); } catch { /* ignore */ }
  }

  return (
    <div className="space-y-4 max-w-6xl">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-lg font-bold text-[#18181B] dark:text-[#F4F4F5] flex items-center gap-2">
            <FileText size={18} className="text-[#F97316]" /> Custom Report Builder
          </h2>
          <p className="text-[15px] text-[#A1A1AA] mt-0.5">Pick any KPI or table, set a date range, brand it, and generate a PDF.</p>
        </div>
        <button
          onClick={generate}
          disabled={generating}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-[15px] font-bold bg-[#F97316] hover:bg-[#EA580C] text-white transition-colors disabled:opacity-60"
        >
          {generating ? <RefreshCw size={14} className="animate-spin" /> : <Download size={14} />}
          {generating ? "Generating…" : "Generate PDF"}
        </button>
      </div>

      {msg && (
        <div className={cn("rounded-xl px-4 py-2.5 text-[15px] font-semibold flex items-center gap-2",
          msg.kind === "ok" ? "bg-[#F0FDF4] text-[#15803D]" : "bg-[#FEF2F2] text-[#991B1B]")}>
          {msg.kind === "ok" ? <Check size={14} /> : <X size={14} />}{msg.text}
        </div>
      )}

      {/* Toolbar: title + date + templates */}
      <Card>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="text-[13px] font-bold text-[#A1A1AA] uppercase tracking-wide block mb-1">Report title</label>
            <input value={branding.reportTitle} onChange={e => setBranding(b => ({ ...b, reportTitle: e.target.value }))}
              placeholder="Performance Report"
              className="w-full bg-[#F5F5F4] dark:bg-[#1C1C1C] border border-black/[0.06] dark:border-white/[0.06] rounded-xl px-3 py-2 text-[15px] dark:text-[#F4F4F5] outline-none focus:border-[#F97316]" />
          </div>
          <div>
            <label className="text-[13px] font-bold text-[#A1A1AA] uppercase tracking-wide block mb-1">Date range</label>
            <select value={preset} onChange={e => setPreset(e.target.value as DatePreset)}
              className="w-full bg-[#F5F5F4] dark:bg-[#1C1C1C] border border-black/[0.06] dark:border-white/[0.06] rounded-xl px-3 py-2 text-[15px] dark:text-[#F4F4F5] outline-none focus:border-[#F97316]">
              {PRESETS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </div>
          <div className="flex items-end gap-2">
            {preset === "custom" ? (
              <>
                <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)}
                  className="flex-1 bg-[#F5F5F4] dark:bg-[#1C1C1C] border border-black/[0.06] dark:border-white/[0.06] rounded-xl px-2 py-2 text-[14px] dark:text-[#F4F4F5] outline-none focus:border-[#F97316]" />
                <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)}
                  className="flex-1 bg-[#F5F5F4] dark:bg-[#1C1C1C] border border-black/[0.06] dark:border-white/[0.06] rounded-xl px-2 py-2 text-[14px] dark:text-[#F4F4F5] outline-none focus:border-[#F97316]" />
              </>
            ) : (
              <button onClick={() => setShowBranding(v => !v)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[15px] font-semibold bg-[#F5F5F4] dark:bg-[#262626] text-[#52525B] dark:text-[#A1A1AA] hover:text-[#F97316] transition-colors w-full justify-center">
                <Palette size={13} /> White-label branding
              </button>
            )}
          </div>
        </div>

        {/* Branding panel */}
        {(showBranding || preset === "custom") && (
          <div className="mt-3 pt-3 border-t border-black/[0.06] dark:border-white/[0.06] grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <label className="text-[13px] font-bold text-[#A1A1AA] uppercase tracking-wide block mb-1">Brand name</label>
              <input value={branding.brandName} onChange={e => setBranding(b => ({ ...b, brandName: e.target.value }))}
                placeholder="Skylitee"
                className="w-full bg-[#F5F5F4] dark:bg-[#1C1C1C] border border-black/[0.06] dark:border-white/[0.06] rounded-xl px-3 py-2 text-[15px] dark:text-[#F4F4F5] outline-none focus:border-[#F97316]" />
            </div>
            <div>
              <label className="text-[13px] font-bold text-[#A1A1AA] uppercase tracking-wide block mb-1">Client name</label>
              <input value={branding.clientName} onChange={e => setBranding(b => ({ ...b, clientName: e.target.value }))}
                placeholder="Client / store name"
                className="w-full bg-[#F5F5F4] dark:bg-[#1C1C1C] border border-black/[0.06] dark:border-white/[0.06] rounded-xl px-3 py-2 text-[15px] dark:text-[#F4F4F5] outline-none focus:border-[#F97316]" />
            </div>
            <div>
              <label className="text-[13px] font-bold text-[#A1A1AA] uppercase tracking-wide block mb-1">Accent color</label>
              <input type="color" value={branding.color} onChange={e => setBranding(b => ({ ...b, color: e.target.value }))}
                className="w-full h-[38px] bg-[#F5F5F4] dark:bg-[#1C1C1C] border border-black/[0.06] dark:border-white/[0.06] rounded-xl px-1 cursor-pointer" />
            </div>
            <div>
              <label className="text-[13px] font-bold text-[#A1A1AA] uppercase tracking-wide block mb-1">Logo</label>
              {branding.logoDataUrl ? (
                <div className="flex items-center gap-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={branding.logoDataUrl} alt="logo" className="h-[38px] w-auto max-w-[80px] object-contain rounded-lg border border-black/[0.06]" />
                  <button onClick={() => setBranding(b => ({ ...b, logoDataUrl: "" }))} className="text-[14px] text-[#EF4444] font-semibold">Remove</button>
                </div>
              ) : (
                <label className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[15px] font-semibold bg-[#F5F5F4] dark:bg-[#262626] text-[#52525B] dark:text-[#A1A1AA] hover:text-[#F97316] transition-colors cursor-pointer">
                  <ImageIcon size={13} /> Upload
                  <input type="file" accept="image/*" onChange={onLogo} className="hidden" />
                </label>
              )}
            </div>
          </div>
        )}

        {/* Templates */}
        {templates.length > 0 && (
          <div className="mt-3 pt-3 border-t border-black/[0.06] dark:border-white/[0.06] flex items-center gap-2 flex-wrap">
            <span className="text-[14px] font-semibold text-[#A1A1AA]">Templates:</span>
            {templates.map(t => (
              <span key={t.id} className="inline-flex items-center gap-1 bg-[#F5F5F4] dark:bg-[#262626] rounded-lg pl-2.5 pr-1 py-1 text-[14px]">
                <button onClick={() => loadTemplate(t)} className="font-semibold text-[#18181B] dark:text-[#F4F4F5] hover:text-[#F97316]">{t.name}</button>
                <button onClick={() => deleteTemplate(t.id)} className="text-[#A1A1AA] hover:text-[#EF4444] p-0.5"><Trash2 size={11} /></button>
              </span>
            ))}
          </div>
        )}
      </Card>

      {/* Builder: left categories, right selection */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 items-start">
        {/* LEFT - every KPI and table, grouped by platform → section */}
        <Card className="lg:col-span-3">
          <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
            <div>
              <div className="text-[16px] font-bold dark:text-[#F4F4F5]">Add KPIs &amp; tables</div>
              <div className="text-[13px] text-[#A1A1AA]">Tick any KPI on its own. KPIs from the same section print together as one table.</div>
            </div>
            <div className="relative w-full sm:w-56">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#A1A1AA]" />
              <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search KPIs (e.g. ROAS)"
                className="w-full bg-[#F5F5F4] dark:bg-[#1C1C1C] border border-black/[0.06] dark:border-white/[0.06] rounded-lg pl-7 pr-2.5 py-1.5 text-[14px] dark:text-[#F4F4F5] outline-none focus:border-[#F97316]" />
            </div>
          </div>
          <div className="space-y-3">
            {REPORT_GROUPS.map(g => {
              const sections = g.sections
                .map(s => ({ ...s, items: s.items.filter(item => matches(item, g.label, s.label)) }))
                .filter(s => s.items.length > 0);
              if (sections.length === 0) return null;
              const groupIds = sections.flatMap(s => s.items.map(item => item.id));
              const groupOn = groupIds.filter(id => selected.includes(id)).length;
              const open = !!q || !collapsed.includes(g.id);
              return (
                <div key={g.id} className="rounded-xl border border-black/[0.06] dark:border-white/[0.06]">
                  <div className="flex items-center gap-2 px-3 py-2">
                    <button onClick={() => toggleGroup(g.id)} className="flex-1 flex items-center gap-1.5 text-left">
                      {open ? <ChevronDown size={15} className="text-[#A1A1AA]" /> : <ChevronRight size={15} className="text-[#A1A1AA]" />}
                      <span className="text-[15px] font-bold text-[#18181B] dark:text-[#F4F4F5]">{g.label}</span>
                      <span className={cn("text-[12px] font-bold rounded-full px-1.5 py-0.5",
                        groupOn ? "bg-[#FFF7ED] dark:bg-[#2A1A0E] text-[#EA580C]" : "text-[#A1A1AA]")}>
                        {groupOn}/{groupIds.length}
                      </span>
                    </button>
                    <button onClick={() => setMany(groupIds, groupOn < groupIds.length)}
                      className="text-[13px] font-semibold text-[#A1A1AA] hover:text-[#F97316]">
                      {groupOn < groupIds.length ? "Select all" : "Clear"}
                    </button>
                  </div>
                  {open && (
                    <div className="px-3 pb-3 space-y-3 border-t border-black/[0.06] dark:border-white/[0.06] pt-2.5">
                      {sections.map(s => {
                        const ids = s.items.map(item => item.id);
                        const allOn = ids.every(id => selected.includes(id));
                        return (
                          <div key={s.id}>
                            <div className="flex items-center justify-between mb-1">
                              <div className="text-[12px] font-bold text-[#A1A1AA] uppercase tracking-wide">{s.label}</div>
                              <button onClick={() => setMany(ids, !allOn)}
                                className="text-[12px] font-semibold text-[#A1A1AA] hover:text-[#F97316]">
                                {allOn ? "None" : "All"}
                              </button>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-2 gap-y-0.5">
                              {s.items.map(item => {
                                const on = selected.includes(item.id);
                                return (
                                  <button key={item.id} onClick={() => toggle(item.id)}
                                    className={cn("w-full flex items-center gap-2 text-left px-2 py-1.5 rounded-lg text-[14px] transition-colors",
                                      on ? "bg-[#FFF7ED] dark:bg-[#2A1A0E] text-[#EA580C]" : "hover:bg-[#F5F5F4] dark:hover:bg-[#1C1C1C] text-[#52525B] dark:text-[#A1A1AA]")}>
                                    <span className={cn("w-4 h-4 rounded border flex items-center justify-center shrink-0",
                                      on ? "bg-[#F97316] border-[#F97316]" : "border-black/20 dark:border-white/20")}>
                                      {on && <Check size={11} className="text-white" />}
                                    </span>
                                    <span className="flex-1">{item.label}</span>
                                    {item.kind === "table" && <Table2 size={12} className="shrink-0 opacity-50" />}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
            {q && REPORT_GROUPS.every(g => g.sections.every(s => s.items.every(item => !matches(item, g.label, s.label)))) && (
              <div className="py-8 text-center text-[14px] text-[#A1A1AA]">No KPI matches &quot;{query}&quot;.</div>
            )}
          </div>
        </Card>

        {/* RIGHT - your report (sticky so it stays visible while ticking KPIs) */}
        <Card className="lg:col-span-2 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto">
          <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
            <div className="text-[16px] font-bold dark:text-[#F4F4F5]">Your report ({selected.length})</div>
            {selected.length > 0 && (
              <button onClick={() => setSelected([])}
                className="flex items-center gap-1 text-[13px] font-semibold text-[#A1A1AA] hover:text-[#EF4444]">
                <Eraser size={12} /> Clear all
              </button>
            )}
          </div>
          <div className="flex items-center gap-1.5 mb-3">
            <input value={templateName} onChange={e => setTemplateName(e.target.value)} placeholder="Save as template..."
              className="flex-1 min-w-0 bg-[#F5F5F4] dark:bg-[#1C1C1C] border border-black/[0.06] dark:border-white/[0.06] rounded-lg px-2.5 py-1.5 text-[14px] dark:text-[#F4F4F5] outline-none focus:border-[#F97316]" />
            <button onClick={saveTemplate} disabled={saving}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[14px] font-bold bg-[#F5F5F4] dark:bg-[#262626] text-[#52525B] dark:text-[#A1A1AA] hover:text-[#F97316] transition-colors disabled:opacity-50">
              <Save size={12} /> Save
            </button>
          </div>
          {selected.length === 0 ? (
            <div className="py-12 text-center text-[15px] text-[#A1A1AA]">
              <Plus size={20} className="mx-auto mb-2 opacity-40" />
              Tick KPIs or tables on the left - they&apos;ll appear here in order.
            </div>
          ) : (
            <div className="space-y-1.5">
              {selected.map((id, i) => (
                <div key={id} className="flex items-center gap-2 bg-[#FAFAF9] dark:bg-[#1C1C1C] rounded-lg px-2.5 py-2">
                  <span className="text-[13px] font-bold text-[#A1A1AA] w-5">{i + 1}</span>
                  <span className="flex-1 min-w-0">
                    <span className="flex items-center gap-1 text-[14px] font-semibold text-[#18181B] dark:text-[#F4F4F5]">
                      {ITEM_BY_ID[id]?.item.kind === "table" && <Table2 size={12} className="shrink-0 text-[#A1A1AA]" />}
                      <span className="truncate">{ITEM_BY_ID[id]?.item.label ?? id}</span>
                    </span>
                    <span className="block text-[12px] text-[#A1A1AA] truncate">
                      {ITEM_BY_ID[id] ? `${ITEM_BY_ID[id].group.label} · ${ITEM_BY_ID[id].section.label}` : ""}
                    </span>
                  </span>
                  <button onClick={() => move(id, -1)} disabled={i === 0} className="text-[#A1A1AA] hover:text-[#F97316] disabled:opacity-30"><ChevronUp size={15} /></button>
                  <button onClick={() => move(id, 1)} disabled={i === selected.length - 1} className="text-[#A1A1AA] hover:text-[#F97316] disabled:opacity-30"><ChevronDown size={15} /></button>
                  <button onClick={() => toggle(id)} className="text-[#A1A1AA] hover:text-[#EF4444]"><X size={14} /></button>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
