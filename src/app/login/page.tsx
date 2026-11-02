"use client";
import { useState } from "react";
import Link from "next/link";
import { Eye, EyeOff } from "lucide-react";
import { SkyLiteeLogo } from "@/components/ui/skylitee-logo";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();

    if (!res.ok) {
      setError(data.error ?? "Login failed");
      setLoading(false);
      return;
    }

    if (data.next) {
      window.location.href = data.next;
    } else if (data.hasShop) {
      window.location.href = "/dashboard";
    } else {
      window.location.href = "/connect";
    }
  };

  return (
    <div className="min-h-screen bg-[#0A0A0A] flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex items-center justify-center gap-2.5 mb-8">
          <SkyLiteeLogo size={36} />
          <div>
            <div className="text-[18px] font-black text-white">Skylitee</div>
            <div className="text-[12px] text-white/50">Unified Analytics Platform</div>
          </div>
        </div>

        {/* Card */}
        <div className="bg-[#111111] border border-white/[0.08] rounded-2xl p-7 shadow-xl">
          <h1 className="text-[20px] font-bold text-white mb-1">Welcome back</h1>
          <p className="text-[14px] text-white/50 mb-6">Sign in to your analytics dashboard</p>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="text-[13px] font-semibold text-white/60 mb-1.5 block uppercase tracking-[0.08em]">Email</label>
              <input
                type="email" value={email} onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full px-3.5 py-2.5 bg-white/[0.05] border border-white/[0.08] rounded-xl text-[15px] text-white focus:outline-none focus:border-[#F97316] placeholder:text-white/20 transition-colors"
                required
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-[13px] font-semibold text-white/60 uppercase tracking-[0.08em]">Password</label>
                <Link href="/forgot-password" className="text-[12px] text-[#F97316] hover:text-[#EA580C] transition-colors">Forgot password?</Link>
              </div>
              <div className="relative">
                <input
                  type={showPw ? "text" : "password"} value={password} onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full px-3.5 py-2.5 bg-white/[0.05] border border-white/[0.08] rounded-xl text-[15px] text-white focus:outline-none focus:border-[#F97316] placeholder:text-white/20 transition-colors"
                  required
                />
                <button type="button" onClick={() => setShowPw(!showPw)} className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 transition-colors">
                  {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>

            {error && (
              <div className="text-[13px] text-[#EF4444] bg-[#EF4444]/10 px-3 py-2.5 rounded-xl border border-[#EF4444]/20">
                {error}
              </div>
            )}

            <button
              type="submit" disabled={loading}
              className="w-full py-2.5 bg-[#F97316] hover:bg-[#EA580C] text-white rounded-xl text-[15px] font-bold transition-all shadow-[0_0_20px_rgba(249,115,22,0.3)] hover:shadow-[0_0_28px_rgba(249,115,22,0.45)] disabled:opacity-50 mt-1"
            >
              {loading ? "Signing in..." : "Sign in →"}
            </button>
          </form>

          <div className="mt-5 pt-4 border-t border-white/[0.06] text-center">
            <span className="text-[14px] text-white/40">Don&apos;t have an account? </span>
            <Link href="/signup" className="text-[14px] text-[#F97316] font-semibold hover:text-[#EA580C] transition-colors">Sign up free</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
