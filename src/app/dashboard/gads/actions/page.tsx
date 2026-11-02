"use client";
import { useMemo, useState } from "react";
import { ListChecks } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/card";
import {
  BenchmarkNote, DiagPanel, EmptyNote, GadsGate, GadsHeader, GoogleCountNote, Pills, useGadsSection,
} from "@/components/gads/shared";
import {
  diagnoseAds, diagnoseAudience, diagnoseKeywords, diagnoseOverview, rankDiags, titleCase,
  type AdsData, type AudienceData, type Diag, type KeywordsData, type OverviewData,
} from "@/lib/gads-analysis";

function Actions({ overview, extra, missing }: { overview: OverviewData; extra: Diag[]; missing: string[] }) {
  const all = useMemo(() => rankDiags([...diagnoseOverview(overview), ...extra]), [overview, extra]);
  const areas = useMemo(() => [...new Set(all.map(d => d.area))], [all]);
  const [area, setArea] = useState("All");
  const shown = area === "All" ? all : all.filter(d => d.area === area);

  return (
    <>
      {missing.length > 0 && (
        <div className="border-l-[3px] border-l-[#EAB308] bg-[#FFFBEB] dark:bg-[#2D1C00] rounded-r-xl p-3 text-[15px] text-[#92400E] dark:text-[#FCD34D]">
          Still loading or unavailable: {missing.join(", ")}. Recommendations from those areas will appear once they load.
        </div>
      )}

      {all.length === 0 && <Card><EmptyNote>Not enough data in this date range to make recommendations. Try a wider range.</EmptyNote></Card>}

      {all.length > 0 && (
        <>
          <Pills
            value={area}
            onChange={setArea}
            options={[{ key: "All", label: "All", count: all.length }, ...areas.map(a => ({ key: a as string, label: a, count: all.filter(d => d.area === a).length }))]}
          />
          <DiagPanel diags={shown} currency={overview.currency} title="Recommendations" right="Biggest money at stake first" />
          <p className="text-[14px] text-[#71717A] dark:text-[#A1A1AA]">
            Amounts show what&apos;s at stake for each item. The same spend can appear under a campaign, a keyword and a search term, so don&apos;t add them together. Skylitee only reads your account: make these changes inside Google Ads.
          </p>
        </>
      )}

      {overview.suggestions.length > 0 && (
        <Card>
          <CardHeader title="Google's own suggestions" right={`${overview.suggestions.length} types`} />
          <div className="overflow-x-auto">
            <table className="w-full text-[15px]">
              <thead>
                <tr className="border-b border-black/[0.06] dark:border-white/[0.06] text-[14px] text-[#71717A] dark:text-[#A1A1AA]">
                  <th className="text-left py-2 px-2 font-semibold">Suggestion</th>
                  <th className="text-right py-2 px-2 font-semibold">Count</th>
                  <th className="text-right py-2 px-2 font-semibold">Google&apos;s estimate: extra conv.</th>
                </tr>
              </thead>
              <tbody>
                {overview.suggestions.map(s => (
                  <tr key={s.type} className="border-b border-black/[0.04] dark:border-white/[0.04] text-[#18181B] dark:text-[#F4F4F5]">
                    <td className="py-2 px-2 font-medium">{titleCase(s.type)}</td>
                    <td className="py-2 px-2 text-right tabular-nums">{s.count}</td>
                    <td className="py-2 px-2 text-right tabular-nums">{s.extraConversions > 0 ? `+${s.extraConversions.toFixed(1)}` : "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[14px] text-[#71717A] dark:text-[#A1A1AA]">These come straight from Google and aren&apos;t based on your profit. Many raise spend, so check each one against your ROAS before accepting it in Google Ads.</p>
        </Card>
      )}

      <BenchmarkNote />
    </>
  );
}

export default function GadsActionsPage() {
  const overview = useGadsSection<OverviewData>("overview");
  const ads = useGadsSection<AdsData>("ads");
  const keywords = useGadsSection<KeywordsData>("keywords");
  const audience = useGadsSection<AudienceData>("audience");

  const extra = useMemo(() => [
    ...(ads.data ? diagnoseAds(ads.data) : []),
    ...(keywords.data ? diagnoseKeywords(keywords.data) : []),
    ...(audience.data ? diagnoseAudience(audience.data) : []),
  ], [ads.data, keywords.data, audience.data]);

  const missing = [
    !ads.data && "ads and ad copy",
    !keywords.data && "keywords",
    !audience.data && "audience",
  ].filter((m): m is string => !!m);

  return (
    <div className="space-y-4">
      <GadsHeader
        icon={ListChecks}
        title="Recommendations"
        subtitle={overview.data ? `${overview.data.account} · ${overview.data.period.from} to ${overview.data.period.to}` : "Everything to fix or scale, ranked by money at stake"}
      />
      <GoogleCountNote mixed />
      <GadsGate state={overview}>{d => <Actions overview={d} extra={extra} missing={missing} />}</GadsGate>
    </div>
  );
}
