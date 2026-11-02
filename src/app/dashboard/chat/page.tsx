"use client";
import { useState, useRef, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { useMounted } from "@/components/ui/period";
import { formatDateSpan, toLocalYMD } from "@/lib/date-range-context";
import { Brain, Send, Zap, ShoppingCart, AlertTriangle, TrendingUp, Package, Users } from "lucide-react";

interface Message {
  role: "user" | "assistant";
  content: string;
}

const suggestions = [
  "Why is my repeat purchase rate low?",
  "Which products should I restock first?",
  "Which customer segment to target this week?",
  "How do I reduce my COD return rate?",
  "How can I improve my repeat purchase rate?",
  "What's my projected monthly revenue?",
  "Which city is driving the most revenue?",
  "What products are at risk of stockout?",
  "How do I increase my AOV?",
  "What should I focus on this week?",
];

export default function ChatPage() {
  const [storeName, setStoreName] = useState("your store");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [aiActions, setAiActions] = useState<{ color: string; text: string }[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const mounted = useMounted();
  const now = new Date();
  const monthSoFar = mounted ? ` (${formatDateSpan(toLocalYMD(new Date(now.getFullYear(), now.getMonth(), 1)), toLocalYMD(now))})` : "";

  useEffect(() => {
    Promise.all([
      fetch("/api/shopify/dashboard").then(r => r.json()).catch(() => null),
      fetch("/api/meta/accounts").then(r => r.json()).catch(() => null),
    ]).then(([d, meta]) => {
      const name = d?.shop ? d.shop.replace(".myshopify.com", "") : "your store";
      setStoreName(name);
      const metaConnected = meta && !meta.error;

      const platformLine = metaConnected
        ? "I also have access to your Meta Ads data - spend, campaigns, CTR, and CPC."
        : "Meta Ads is not connected yet - connect in Settings → Connections to unlock campaign-level analysis.";

      setMessages([{
        role: "assistant",
        content: `Hi! I have full access to ${name}'s Shopify orders, inventory, customer data, and I'm watching for anomalies in real time.\n\n${platformLine}\n\nAsk me anything: which products to reorder, what's driving returns, who your best customers are, or what to focus on this week.`,
      }]);

      if (d?.kpis) {
        const kpis = d.kpis;
        const codPct = kpis.totalOrders > 0 ? Math.round((kpis.codOrders / kpis.totalOrders) * 100) : 0;
        const actions = [];
        if (codPct > 50) actions.push({ color: "bg-[#d94040]", text: `High COD rate: ${codPct}% of orders - consider prepaid incentive` });
        if (kpis.totalOrders > 0) actions.push({ color: "bg-[#17a773]", text: `${kpis.totalOrders} orders processed · ₹${kpis.grossSales.toLocaleString("en-IN")} revenue` });
        if (kpis.newCustomers > 0) actions.push({ color: "bg-[#3478d4]", text: `${kpis.newCustomers} new customers so far this month` });
        if (kpis.returningCustomers > 0) actions.push({ color: "bg-[#17a773]", text: `${kpis.returningCustomers} returning customers - repeat purchase detected` });
        if (metaConnected) {
          actions.push({ color: "bg-[#1877F2]", text: "Meta Ads connected - campaign spend & CTR data available" });
        } else {
          actions.push({ color: "bg-[#e89820]", text: "Meta Ads not connected - campaign data unavailable" });
        }
        setAiActions(actions);
      }
    }).catch(() => {
      setMessages([{
        role: "assistant",
        content: "Hi! Connect your Shopify store in Settings → Connections to get personalised insights about your orders, customers, and products.",
      }]);
    });
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = async (text?: string) => {
    const userText = text || input.trim();
    if (!userText || loading) return;

    const newMessages: Message[] = [...messages, { role: "user", content: userText }];
    setMessages(newMessages);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: newMessages }),
      });

      if (!res.ok) throw new Error("API error");

      const data = await res.json();
      setMessages([...newMessages, { role: "assistant", content: data.reply }]);
    } catch {
      setMessages([...newMessages, {
        role: "assistant",
        content: "Sorry, I couldn't connect to the AI right now. Please ensure your ANTHROPIC_API_KEY is set and try again.",
      }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <div className="mb-3">
        <h2 className="text-lg font-semibold">AI Assistant</h2>
        <p className="text-[17px] text-[#686864] mt-0.5">Ask anything · Shopify connected · {storeName}</p>
        <p className="text-[14px] text-[#71717A] mt-0.5">Answers use your store&apos;s numbers for this month so far{monthSoFar}, and the last 28 days for ads and traffic</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
        {/* Chat */}
        <div className="flex flex-col bg-white border border-black/[0.09] rounded-xl overflow-hidden" style={{ height: 520 }}>
          {/* Chat header */}
          <div className="flex items-center gap-2.5 px-3.5 py-2.5 border-b border-black/[0.09] bg-[#f7f7f5]">
            <div className="w-7 h-7 bg-[#17a773] rounded-lg flex items-center justify-center">
              <Brain size={13} className="text-white" />
            </div>
            <div>
              <div className="text-[16px] font-semibold text-[#181816]">Skylitee AI</div>
              <div className="text-[15px] text-[#686864]">Shopify · Anomaly detection · Real-time</div>
            </div>
            <div className="ml-auto flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-[#17a773]" />
              <span className="text-[15px] text-[#0d6b4f]">Live</span>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-3.5 flex flex-col gap-2.5">
            {messages.map((msg, i) => (
              <div key={i} className={`max-w-[86%] ${msg.role === "user" ? "self-end" : "self-start"}`}>
                <div className="text-[15px] text-[#9e9e9a] mb-1" style={{ textAlign: msg.role === "user" ? "right" : "left" }}>
                  {msg.role === "user" ? "You" : "Skylitee AI"}
                </div>
                <div
                  className={`px-3 py-2.5 text-[16px] leading-relaxed whitespace-pre-wrap ${
                    msg.role === "user"
                      ? "bg-[#17a773] text-white rounded-xl rounded-tr-sm"
                      : "bg-[#f7f7f5] text-[#181816] rounded-xl rounded-tl-sm"
                  }`}
                  dangerouslySetInnerHTML={{
                    __html: msg.content.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>").replace(/\n/g, "<br>"),
                  }}
                />
              </div>
            ))}
            {loading && (
              <div className="self-start max-w-[86%]">
                <div className="text-[15px] text-[#9e9e9a] mb-1">Skylitee AI</div>
                <div className="bg-[#f7f7f5] px-3 py-2.5 rounded-xl rounded-tl-sm flex gap-1 items-center">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#17a773] animate-bounce" style={{ animationDelay: "0ms" }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-[#17a773] animate-bounce" style={{ animationDelay: "150ms" }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-[#17a773] animate-bounce" style={{ animationDelay: "300ms" }} />
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Suggestions */}
          <div className="px-3 py-2 border-t border-black/[0.09] bg-[#f7f7f5]">
            <div className="text-[15px] text-[#9e9e9a] mb-1.5">Try asking:</div>
            <div className="flex flex-wrap gap-1.5 overflow-hidden" style={{ maxHeight: 54 }}>
              {suggestions.slice(0, 4).map((s, i) => (
                <button
                  key={i}
                  onClick={() => sendMessage(s)}
                  className="px-2.5 py-1 border border-black/[0.09] rounded-full text-[15px] text-[#686864] bg-white hover:bg-[#e0f5ee] hover:text-[#064d38] hover:border-[#9FE1CB] transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* Input */}
          <div className="px-3 py-2.5 border-t border-black/[0.09] flex gap-2">
            <input
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && sendMessage()}
              placeholder="Ask about orders, customers, products, revenue..."
              className="flex-1 px-2.5 py-2 bg-[#f7f7f5] border border-black/[0.09] rounded-lg text-[16px] text-[#181816] focus:outline-none focus:border-[#17a773] placeholder:text-[#9e9e9a]"
              disabled={loading}
            />
            <button
              onClick={() => sendMessage()}
              disabled={loading || !input.trim()}
              className="px-3 py-2 bg-[#17a773] text-white rounded-lg text-[16px] font-semibold disabled:opacity-50 hover:bg-[#0d6b4f] transition-colors flex items-center gap-1.5"
            >
              <Send size={12} /> Send
            </button>
          </div>
        </div>

        {/* Right panel */}
        <div>
          <Card className="mb-2">
            <div className="text-[16px] font-semibold text-[#181816] mb-3">What I can analyse</div>
            {[
              {
                label: "Orders & revenue",
                qs: ['"What are my best selling products?"', '"How much revenue did I make this week?"', '"What is my AOV trend?"', '"Which orders are COD vs prepaid?"'],
              },
              {
                label: "Customers & retention",
                qs: ['"Who are my most valuable customers?"', '"How many customers have returned?"', '"Which city has the most orders?"', '"How can I improve repeat purchase rate?"'],
              },
              {
                label: "Inventory & operations",
                qs: ['"Which products are at risk of stockout?"', '"What should I reorder today?"', '"How many days of stock do I have?"', '"What is my projected monthly revenue?"'],
              },
            ].map((section) => (
              <div key={section.label} className="mb-3">
                <div className="text-[16px] font-semibold text-[#9e9e9a] uppercase tracking-wider pb-1 border-b border-black/[0.09] mb-1.5">{section.label}</div>
                <div className="text-[16px] text-[#686864] space-y-0.5">
                  {section.qs.map((q, i) => (
                    <div key={i} className="leading-relaxed cursor-pointer hover:text-[#0d6b4f]" onClick={() => sendMessage(q.replace(/['"]/g, ""))}>{q}</div>
                  ))}
                </div>
              </div>
            ))}
          </Card>

          <Card>
            <div className="text-[16px] font-semibold text-[#181816] mb-3 flex items-center gap-1.5">
              <Zap size={12} className="text-[#17a773]" /> Live store signals
            </div>
            <div className="flex flex-col gap-2">
              {aiActions.length > 0 ? aiActions.map((a, i) => (
                <div key={i} className="flex items-start gap-2 text-[16px]">
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 mt-1 ${a.color}`} />
                  <span className="flex-1 leading-relaxed">{a.text}</span>
                </div>
              )) : (
                <div className="text-[16px] text-[#9e9e9a]">Loading store signals...</div>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
