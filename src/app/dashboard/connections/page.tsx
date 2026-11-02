"use client";
import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Card, CardHeader } from "@/components/ui/card";
import { ShoppingBag, Share2, Search, Megaphone, CheckCircle2, XCircle, BarChart2 } from "lucide-react";

interface GoogleSite { url: string; }
interface GA4Property { id: string; name: string; account: string; }
interface MetaAccount { id: string; name: string; currency: string; }
interface GadsCustomer { id: string; name: string; currency: string; }

// ?error= codes set by the OAuth callbacks → plain-English reason + fix.
const CONNECT_ERRORS: Record<string, string> = {
  google_denied: "Google did not give access. If Google showed \"This app isn't verified\", click Advanced → Go to skylitee.io, then tick every permission box and press Continue. If it said \"Access blocked\", your Google Workspace admin must allow Skylitee.",
  google_state: "The Google sign-in expired or was opened on a different web address. Open Skylitee at skylitee.io and click Connect again.",
  no_refresh_token: "Google did not return a long-term access key. Remove Skylitee at myaccount.google.com/permissions, then click Connect again.",
  google_failed: "Google sign-in failed on our side. Please click Connect again - if it repeats, contact support.",
  google: "Google sign-in did not finish. Please click Connect again.",
  view_only: "Your role on this store can't change connections. Ask the store owner to connect it.",
};

function ConnectionsContent() {
  const router = useRouter();
  const connectError = CONNECT_ERRORS[useSearchParams().get("error") ?? ""] ?? null;
  const [toastMsg, setToastMsg] = useState("");

  const [shopName, setShopName] = useState<string | null>(null);

  // GSC - independent connection
  const [gscConnected, setGscConnected] = useState(false);
  const [gscSites, setGscSites] = useState<GoogleSite[]>([]);
  const [selectedGsc, setSelectedGsc] = useState("");
  const [gscSaved, setGscSaved] = useState(false);

  // GA4 - independent connection
  const [ga4Connected, setGa4Connected] = useState(false);
  const [ga4Properties, setGa4Properties] = useState<GA4Property[]>([]);
  const [selectedGa4, setSelectedGa4] = useState("");
  const [ga4Saved, setGa4Saved] = useState(false);

  // Google Ads - independent connection
  const [gadsConnected, setGadsConnected] = useState(false);
  const [gadsCustomers, setGadsCustomers] = useState<GadsCustomer[]>([]);
  const [selectedGads, setSelectedGads] = useState("");
  const [gadsSaved, setGadsSaved] = useState(false);
  const [gadsError, setGadsError] = useState<string | null>(null);
  const [gadsErrorDetail, setGadsErrorDetail] = useState("");

  // Meta
  const [metaConnected, setMetaConnected] = useState(false);
  const [metaAccounts, setMetaAccounts] = useState<MetaAccount[]>([]);
  const [selectedMeta, setSelectedMeta] = useState("");
  const [metaSaved, setMetaSaved] = useState(false);
  const [metaUserName, setMetaUserName] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);

  // Marketing / view-only members see status but can't connect, disconnect or change accounts.
  const [canEdit, setCanEdit] = useState(true);
  const [role, setRole] = useState<string | null>(null);

  // Locked = someone else (e.g. an agency) connected this login; only they may switch accounts.
  // Value = who connected it (shown to the user).
  const [locks, setLocks] = useState<Partial<Record<"gsc" | "ga4" | "gads" | "meta", string>>>({});

  useEffect(() => {
    fetch("/api/auth/me")
      .then(r => r.json())
      .then(d => { setCanEdit(d.can?.connections !== false); setRole(d.role ?? null); })
      .catch(() => {});

    fetch("/api/shopify/dashboard")
      .then(r => r.json())
      .then(d => { if (d.shop) setShopName(d.shop); })
      .catch(() => {});

    fetch("/api/google/sites")
      .then(r => r.json())
      .then(d => {
        if (d.error) return;
        setGscConnected(!!d.gscConnected);
        setGa4Connected(!!d.ga4Connected);
        setGadsConnected(!!d.gadsConnected);
        setGscSites(d.gscSites ?? []);
        setGa4Properties(d.ga4Properties ?? []);
        setSelectedGsc(d.savedGscSite ?? d.gscSites?.[0]?.url ?? "");
        setSelectedGa4(d.savedGa4Property ?? d.ga4Properties?.[0]?.id ?? "");
        setGscSaved(!!d.savedGscSite);
        setGa4Saved(!!d.savedGa4Property);
        setLocks(l => ({
          ...l,
          ...(d.gscLocked ? { gsc: d.gscConnectedBy ?? "" } : {}),
          ...(d.ga4Locked ? { ga4: d.ga4ConnectedBy ?? "" } : {}),
        }));
      })
      .catch(() => {});

    fetch("/api/google/ads/customers")
      .then(r => r.json())
      .then(d => {
        if (d.error === "not_connected") return;
        if (d.error === "google_ads_dev_token_missing") { setGadsError("dev_token"); return; }
        if (d.locked) {
          setLocks(l => ({ ...l, gads: d.connectedBy ?? "" }));
          setGadsCustomers(d.customers ?? []);
          setSelectedGads(d.savedCustomerId ?? "");
          setGadsSaved(!!d.savedCustomerId);
          return;
        }
        // If listing failed, still restore any saved customer ID
        if (d.error) {
          setGadsError(d.error);
          setGadsErrorDetail(d.detail ?? "");
          if (d.savedCustomerId) { setSelectedGads(d.savedCustomerId); setGadsSaved(true); }
          return;
        }
        setGadsCustomers(d.customers ?? []);
        setSelectedGads(d.savedCustomerId ?? d.customers?.[0]?.id ?? "");
        setGadsSaved(!!d.savedCustomerId);
      })
      .catch(() => {});

    fetch("/api/meta/accounts")
      .then(r => r.json())
      .then(d => {
        if (d.error) return;
        setMetaConnected(true);
        setMetaUserName(d.connectedUserName ?? null);
        setMetaAccounts(d.accounts ?? []);
        setSelectedMeta(d.selectedAccountId ?? d.accounts?.[0]?.id ?? "");
        setMetaSaved(!!d.selectedAccountId);
        if (d.locked) setLocks(l => ({ ...l, meta: d.connectedBy ?? "" }));
      })
      .catch(() => {});
  }, []);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(""), 3000);
  };

  const disconnectShopify = async () => {
    if (!confirm("Disconnect Shopify? The dashboard will lose access to your store data.")) return;
    await fetch("/api/auth/shopify/disconnect", { method: "POST" });
    setShopName(null);
    showToast("Shopify disconnected - redirecting to install page");
    setTimeout(() => router.push("/install"), 1500);
  };

  const disconnectGsc = async () => {
    if (!confirm("Disconnect Search Console? GSC keyword data will be removed from your dashboard.")) return;
    await fetch("/api/auth/google/disconnect?service=gsc", { method: "POST" });
    setGscConnected(false);
    setGscSites([]);
    setGscSaved(false);
    showToast("Search Console disconnected");
  };

  const disconnectGa4 = async () => {
    if (!confirm("Disconnect Google Analytics 4? GA4 session and traffic data will be removed.")) return;
    await fetch("/api/auth/google/disconnect?service=ga4", { method: "POST" });
    setGa4Connected(false);
    setGa4Properties([]);
    setGa4Saved(false);
    showToast("Google Analytics 4 disconnected");
  };

  const disconnectGads = async () => {
    if (!confirm("Disconnect Google Ads? Campaign and keyword data will be removed from the dashboard.")) return;
    await fetch("/api/auth/google/disconnect?service=gads", { method: "POST" });
    setGadsConnected(false);
    setGadsCustomers([]);
    setGadsSaved(false);
    showToast("Google Ads disconnected");
  };

  const saveGadsCustomer = async () => {
    setSaving(true);
    await fetch("/api/google/ads/customers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customerId: selectedGads }),
    });
    setSaving(false);
    setGadsSaved(true);
    showToast("Google Ads account saved!");
  };

  const disconnectMeta = async () => {
    if (!confirm("Disconnect Meta? All Meta Ads data will be removed from the dashboard.")) return;
    await fetch("/api/auth/meta/disconnect", { method: "POST" });
    setMetaConnected(false);
    setMetaAccounts([]);
    setMetaSaved(false);
    showToast("Meta disconnected");
  };

  const saveMetaAccount = async () => {
    setSaving(true);
    await fetch("/api/meta/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ adAccount: selectedMeta }),
    });
    setSaving(false);
    setMetaSaved(true);
    showToast("Meta ad account saved!");
  };

  const saveGscSite = async () => {
    setSaving(true);
    await fetch("/api/google/sites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gscSite: selectedGsc }),
    });
    setSaving(false);
    setGscSaved(true);
    showToast("Search Console site saved!");
  };

  const saveGa4Property = async () => {
    setSaving(true);
    await fetch("/api/google/sites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ga4Property: selectedGa4 }),
    });
    setSaving(false);
    setGa4Saved(true);
    showToast("GA4 property saved!");
  };

  const platforms = [
    {
      name: "Shopify Store",
      icon: <ShoppingBag size={17} className="text-white" />,
      bg: "bg-[#96BF48]",
      status: shopName ? "connected" : "disconnected",
      detail: shopName ? `${shopName} · Live sync` : "Not connected",
      href: "/install",
      disconnectFn: shopName ? disconnectShopify : null,
    },
    {
      name: "Google Search Console",
      icon: <Search size={17} className="text-white" />,
      bg: "bg-[#4285F4]",
      status: gscConnected ? "connected" : "disconnected",
      detail: gscConnected
        ? `Connected · ${gscSaved ? "site selected" : "select site below"}`
        : "Not connected - can use a different Google account than GA4",
      href: "/api/auth/google?service=gsc",
      disconnectFn: gscConnected ? disconnectGsc : null,
    },
    {
      name: "Google Analytics 4",
      icon: <BarChart2 size={17} className="text-white" />,
      bg: "bg-[#E37400]",
      status: ga4Connected ? "connected" : "disconnected",
      detail: ga4Connected
        ? `Connected · ${ga4Saved ? "property selected" : "select property below"}`
        : "Not connected - can use a different Google account than GSC",
      href: "/api/auth/google?service=ga4",
      disconnectFn: ga4Connected ? disconnectGa4 : null,
    },
    {
      name: "Meta Business Suite",
      icon: <Share2 size={17} className="text-white" />,
      bg: "bg-[#1877F2]",
      status: metaConnected ? "connected" : "disconnected",
      detail: metaConnected
        ? `${metaUserName ? `${metaUserName} · ` : ""}${metaSaved ? "ad account selected" : metaAccounts.length === 0 ? "no ad accounts found" : "select ad account below"}`
        : "Not connected",
      href: "/api/auth/meta",
      disconnectFn: metaConnected ? disconnectMeta : null,
    },
    {
      name: "Google Ads",
      icon: <Megaphone size={17} className="text-white" />,
      bg: "bg-[#34A853]",
      status: gadsConnected ? "connected" : "disconnected",
      detail: gadsConnected
        ? `Connected · ${gadsSaved ? "account selected" : "select account below"}`
        : "Not connected - track campaign spend, ROAS & keywords",
      href: "/api/auth/google?service=gads",
      disconnectFn: gadsConnected ? disconnectGads : null,
    },
  ];

  return (
    <div>
      <div className="mb-3">
        <h2 className="text-lg font-semibold">Platform Connections</h2>
        <p className="text-[17px] text-[#686864] mt-0.5">Manage integrations · GSC and GA4 can be on different Google accounts</p>
      </div>

      {connectError && (
        <div className="mb-3 px-3 py-2.5 rounded-lg bg-[#fce8e8] border border-[#f5a0a0] text-[15px] text-[#a32d2d] flex gap-2">
          <XCircle size={17} className="shrink-0 mt-0.5" />
          <span><strong>Couldn&apos;t connect.</strong> {connectError}</span>
        </div>
      )}

      {!canEdit && (
        <div className="mb-3 px-3 py-2.5 rounded-lg bg-[#f7f7f5] border border-black/[0.08] text-[15px] text-[#686864]">
          You have {role === "view_only" ? "view-only" : "read-only connection"} access to this store. Contact the store owner to change connections.
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <Card>
          <CardHeader title="Connected platforms" />
          {platforms.map((p, i) => (
            <div key={i} className="flex items-center gap-3 py-3 border-b border-black/[0.06] last:border-0">
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${p.bg}`}>
                {p.icon}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[16px] font-semibold text-[#181816]">{p.name}</div>
                <div className={`text-[15px] mt-0.5 ${p.status === "connected" ? "text-[#0d6b4f]" : "text-[#686864]"}`}>
                  {p.status === "connected" ? "✓" : "○"} {p.detail}
                </div>
              </div>
              <div className="flex gap-1.5 shrink-0">
                {p.status === "connected" ? (
                  <>
                    <span className="px-3 py-1.5 rounded-lg text-[16px] font-medium bg-[#e0f5ee] border border-[#9FE1CB] text-[#064d38]">
                      Connected
                    </span>
                    {p.disconnectFn && canEdit && (
                      <button
                        onClick={p.disconnectFn}
                        className="px-2.5 py-1.5 rounded-lg text-[16px] font-medium bg-[#fce8e8] border border-[#f5a0a0] text-[#d94040] hover:bg-[#fbd5d5] transition-colors"
                      >
                        Disconnect
                      </button>
                    )}
                  </>
                ) : !canEdit ? (
                  <span className="px-3 py-1.5 rounded-lg text-[16px] font-medium bg-[#f7f7f5] border border-black/[0.08] text-[#686864]">
                    Not connected
                  </span>
                ) : p.href ? (
                  <a
                    href={p.href}
                    className="px-3 py-1.5 rounded-lg text-[16px] font-medium bg-[#17a773] text-white border border-[#17a773] hover:bg-[#0d6b4f] transition-colors whitespace-nowrap"
                  >
                    Connect Now
                  </a>
                ) : (
                  <button
                    onClick={() => showToast("Coming soon")}
                    className="px-3 py-1.5 rounded-lg text-[16px] font-medium bg-[#17a773] text-white border border-[#17a773] hover:bg-[#0d6b4f] transition-colors"
                  >
                    Connect Now
                  </button>
                )}
              </div>
            </div>
          ))}

          {/* Locked: connected by someone else (agency) - show only this store's saved account */}
          {([
            ["gsc", gscConnected, "Search Console", gscSites.find(s => s.url === selectedGsc)?.url ?? (gscSaved ? selectedGsc : "")],
            ["ga4", ga4Connected, "Analytics GA4", (() => { const p = ga4Properties.find(x => x.id === selectedGa4); return p ? `${p.name} · ID ${p.id.replace("properties/", "")}` : ga4Saved ? selectedGa4 : ""; })()],
            ["gads", gadsConnected, "Google Ads", gadsSaved ? `Customer ID ${selectedGads}` : ""],
            ["meta", metaConnected, "Meta Ads", (() => { const a = metaAccounts.find(x => x.id === selectedMeta); return metaSaved ? (a ? `${a.name} - ${a.id}` : selectedMeta) : ""; })()],
          ] as const).map(([svc, connected, label, account]) => locks[svc] !== undefined && connected && (
            <div key={svc} className="mt-3 pt-3 border-t border-black/[0.06]">
              <div className="text-[16px] font-semibold text-[#181816] mb-1.5">{label} - account in use</div>
              <div className="text-[16px] text-[#181816] bg-[#f7f7f5] border border-black/[0.08] rounded-lg px-2.5 py-1.5 mb-1.5 break-all">
                {account || "No account selected yet"}
              </div>
              <div className="text-[15px] text-[#686864]">
                Connected by {locks[svc] || "another user"} - only they can change which account is used.
                {canEdit && " To use your own login instead, Disconnect above and connect your account."}
              </div>
            </div>
          ))}

          {/* GSC site picker */}
          {canEdit && locks.gsc === undefined && gscConnected && gscSites.length > 0 && (
            <div className="mt-3 pt-3 border-t border-black/[0.06]">
              <div className="flex items-center justify-between mb-2">
                <div className="text-[16px] font-semibold text-[#181816] flex items-center gap-1.5">
                  <Search size={11} className="text-[#4285F4]" /> Search Console - select site
                </div>
                {gscSaved && <span className="text-[15px] text-[#0d6b4f]">✓ Saved</span>}
              </div>
              <select
                value={selectedGsc}
                onChange={e => { setSelectedGsc(e.target.value); setGscSaved(false); }}
                className="w-full text-[17px] border border-black/[0.12] rounded-lg px-2.5 py-1.5 bg-white mb-2"
              >
                {gscSites.map(s => (
                  <option key={s.url} value={s.url}>{s.url}</option>
                ))}
              </select>
              <button
                onClick={saveGscSite}
                disabled={saving || gscSaved}
                className="w-full py-2 bg-[#4285F4] text-white rounded-lg text-[16px] font-semibold hover:bg-[#3367d6] disabled:opacity-50 transition-colors"
              >
                {saving ? "Saving..." : gscSaved ? "✓ Saved - change dropdown to update" : "Save GSC Site"}
              </button>
            </div>
          )}

          {/* GA4 property picker */}
          {canEdit && locks.ga4 === undefined && ga4Connected && ga4Properties.length > 0 && (
            <div className="mt-3 pt-3 border-t border-black/[0.06]">
              <div className="flex items-center justify-between mb-2">
                <div className="text-[16px] font-semibold text-[#181816] flex items-center gap-1.5">
                  <BarChart2 size={11} className="text-[#E37400]" /> Analytics GA4 - select property
                </div>
                {ga4Saved && <span className="text-[15px] text-[#0d6b4f]">✓ Saved</span>}
              </div>
              <select
                value={selectedGa4}
                onChange={e => { setSelectedGa4(e.target.value); setGa4Saved(false); }}
                className="w-full text-[17px] border border-black/[0.12] rounded-lg px-2.5 py-1.5 bg-white mb-2"
              >
                {ga4Properties.map(p => {
                    const numericId = p.id.replace("properties/", "");
                    return (
                      <option key={p.id} value={p.id}>
                        {p.name} - {p.account} · ID {numericId}
                      </option>
                    );
                  })}
              </select>
              <button
                onClick={saveGa4Property}
                disabled={saving || ga4Saved}
                className="w-full py-2 bg-[#E37400] text-white rounded-lg text-[16px] font-semibold hover:bg-[#c85f00] disabled:opacity-50 transition-colors"
              >
                {saving ? "Saving..." : ga4Saved ? "✓ Saved - change dropdown to update" : "Save GA4 Property"}
              </button>
            </div>
          )}

          {/* Google Ads customer picker */}
          {canEdit && locks.gads === undefined && gadsConnected && (
            <div className="mt-3 pt-3 border-t border-black/[0.06]">
              <div className="flex items-center justify-between mb-2">
                <div className="text-[16px] font-semibold text-[#181816] flex items-center gap-1.5">
                  <Megaphone size={11} className="text-[#34A853]" /> Google Ads - select account
                </div>
                {gadsSaved && <span className="text-[15px] text-[#0d6b4f]">✓ Saved</span>}
              </div>
              {gadsError === "dev_token" ? (
                <div className="text-[15px] text-[#a05a00] bg-[#fff3e0] border border-[#ffcc80] rounded-lg px-3 py-2.5">
                  Add <code className="font-mono text-[14px]">GOOGLE_ADS_DEVELOPER_TOKEN</code> in Vercel environment variables to enable Google Ads.
                </div>
              ) : (gadsError && gadsCustomers.length === 0) ? (
                /* Listing failed - show the real reason, allow manual entry */
                <div className="space-y-2">
                  <div className="text-[15px] text-[#7a5a00] bg-[#fffbe6] border border-[#ffe58f] rounded-lg px-3 py-2.5">
                    <div className="font-semibold mb-0.5">Account list not available</div>
                    <div>
                      {gadsError === "test_token" ? "Skylitee doesn't have Google's full Google Ads API access yet, so we can't list your ad accounts." :
                       gadsError === "api_disabled" ? "The Google Ads API is switched off in Skylitee's Google Cloud project, so we can't list your ad accounts. This is on Skylitee's side." :
                       gadsError === "no_customers" ? "Google found no ad accounts for this login." :
                       `Google returned an error: ${gadsErrorDetail || gadsError}`}
                      {" "}You can enter your Customer ID manually - find it in Google Ads → top-right account picker (e.g. <span className="font-mono">401-789-2231</span>).
                    </div>
                  </div>
                  <input
                    type="text"
                    value={selectedGads}
                    onChange={e => { setSelectedGads(e.target.value); setGadsSaved(false); }}
                    placeholder="e.g. 4017892231 (remove hyphens)"
                    className="w-full text-[16px] border border-black/[0.12] rounded-lg px-2.5 py-1.5 bg-white"
                  />
                  {gadsSaved && <div className="text-[15px] text-[#0d6b4f]">✓ Saved Customer ID: {selectedGads}</div>}
                  <button
                    onClick={saveGadsCustomer}
                    disabled={saving || !selectedGads || gadsSaved}
                    className="w-full py-2 bg-[#34A853] text-white rounded-lg text-[16px] font-semibold hover:bg-[#2d9248] disabled:opacity-50 transition-colors"
                  >
                    {saving ? "Saving..." : gadsSaved ? "✓ Saved - type new ID to update" : "Save Customer ID"}
                  </button>
                </div>
              ) : gadsCustomers.length === 0 ? (
                <div className="text-[15px] text-[#686864] bg-[#f7f7f5] rounded-lg px-3 py-2.5">
                  No Google Ads accounts found. Make sure you are an admin of a Google Ads account.
                </div>
              ) : (
                <>
                  <select
                    value={selectedGads}
                    onChange={e => { setSelectedGads(e.target.value); setGadsSaved(false); }}
                    className="w-full text-[17px] border border-black/[0.12] rounded-lg px-2.5 py-1.5 bg-white mb-2"
                  >
                    {gadsCustomers.map(a => (
                      <option key={a.id} value={a.id}>{a.name} · ID {a.id}{a.currency ? ` (${a.currency})` : ""}</option>
                    ))}
                  </select>
                  <button
                    onClick={saveGadsCustomer}
                    disabled={saving || gadsSaved}
                    className="w-full py-2 bg-[#34A853] text-white rounded-lg text-[16px] font-semibold hover:bg-[#2d9248] disabled:opacity-50 transition-colors"
                  >
                    {saving ? "Saving..." : gadsSaved ? "✓ Saved - change dropdown to update" : "Save Google Ads Account"}
                  </button>
                </>
              )}
            </div>
          )}

          {/* Meta ad account picker */}
          {canEdit && locks.meta === undefined && metaConnected && (
            <div className="mt-3 pt-3 border-t border-black/[0.06]">
              <div className="flex items-center justify-between mb-2">
                <div className="text-[16px] font-semibold text-[#181816] flex items-center gap-1.5">
                  <Share2 size={11} className="text-[#1877F2]" /> Meta - select ad account
                </div>
                {metaSaved && <span className="text-[15px] text-[#0d6b4f]">✓ Saved</span>}
              </div>
              {metaAccounts.length === 0 ? (
                <div className="text-[15px] text-[#a05a00] bg-[#fff3e0] border border-[#ffcc80] rounded-lg px-3 py-2.5">
                  No ad accounts found under this Meta account. Make sure you are an admin of a Meta Business ad account.
                </div>
              ) : (
                <>
                  <select
                    value={selectedMeta}
                    onChange={e => { setSelectedMeta(e.target.value); setMetaSaved(false); }}
                    className="w-full text-[17px] border border-black/[0.12] rounded-lg px-2.5 py-1.5 bg-white mb-2"
                  >
                    {metaAccounts.map(a => (
                      <option key={a.id} value={a.id}>{a.name} - {a.id} ({a.currency})</option>
                    ))}
                  </select>
                  <button
                    onClick={saveMetaAccount}
                    disabled={saving || metaSaved}
                    className="w-full py-2 bg-[#1877F2] text-white rounded-lg text-[16px] font-semibold hover:bg-[#1565c0] disabled:opacity-50 transition-colors"
                  >
                    {saving ? "Saving..." : metaSaved ? "✓ Saved - change dropdown to update" : "Save Ad Account"}
                  </button>
                </>
              )}
            </div>
          )}
        </Card>

        <div>
          <Card className="mb-2">
            <CardHeader title="Sync status" />
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: "Shopify", status: !!shopName, detail: "Orders, products, customers" },
                { label: "Search Console", status: gscConnected && gscSaved, detail: "Keyword rankings & clicks" },
                { label: "Analytics GA4", status: ga4Connected && ga4Saved, detail: "Sessions, users, bounce rate" },
                { label: "Meta Ads", status: metaConnected && metaSaved, detail: "Ad campaigns & ROAS" },
                { label: "Google Ads", status: gadsConnected && gadsSaved, detail: "Campaigns, keywords, ROAS" },
              ].map((p, i) => (
                <div key={i} className="p-3 bg-[#f7f7f5] rounded-lg">
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className={`w-2 h-2 rounded-full ${p.status ? "bg-[#17a773]" : "bg-[#d94040]"}`} />
                    <span className="text-[16px] font-semibold text-[#181816]">{p.label}</span>
                  </div>
                  <div className="text-[15px] text-[#686864]">{p.detail}</div>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <CardHeader title="Multi-account Google support" />
            <div className="bg-[#e4eef9] rounded-lg p-3 text-[15px] text-[#0a3d7a] space-y-1.5 mb-2">
              {[
                "Search Console and GA4 connect independently",
                "Each can use a completely different Google account",
                "Skylitee stores a separate token per service - no conflicts",
                "Disconnect and reconnect each service individually at any time",
              ].map((item, i) => (
                <div key={i} className="flex items-start gap-1.5">
                  <CheckCircle2 size={11} className="text-[#3478d4] shrink-0 mt-0.5" />
                  <span>{item}</span>
                </div>
              ))}
            </div>
            {(!metaConnected || !gadsConnected) && (
              <div className="bg-[#fce8e8] rounded-lg p-3 text-[15px] text-[#6e1c1c] border border-[#f5a0a0]">
                <div className="flex items-center gap-1.5 font-semibold mb-1">
                  <XCircle size={12} />
                  {!metaConnected && !gadsConnected ? "Meta & Google Ads not connected" :
                   !metaConnected ? "Meta Ads not connected" : "Google Ads not connected"}
                </div>
                <div>Connect when ready to track ad spend and ROAS across channels.</div>
              </div>
            )}
          </Card>
        </div>
      </div>

      {toastMsg && (
        <div className="fixed bottom-4 right-4 bg-[#18181e] text-white px-3.5 py-2 rounded-lg text-[16px] font-medium z-50 shadow-lg">
          ✓ {toastMsg}
        </div>
      )}
    </div>
  );
}

export default function ConnectionsPage() {
  return (
    <Suspense fallback={<div className="text-[17px] text-[#686864] py-8 text-center">Loading...</div>}>
      <ConnectionsContent />
    </Suspense>
  );
}
