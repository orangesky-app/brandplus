"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Eye, EyeOff } from "lucide-react";
import { SkyLiteeLogo } from "@/components/ui/skylitee-logo";

export default function SignupPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [fromInstall, setFromInstall] = useState(false);

  useEffect(() => {
    setFromInstall(new URLSearchParams(window.location.search).get("from") === "install");
  }, []);

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    const res = await fetch("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, password }),
    });
    const data = await res.json();

    if (!res.ok) {
      setError(data.error ?? "Signup failed");
      setLoading(false);
      return;
    }

    router.push(data.next ?? (data.hasInvites ? "/dashboard" : "/connect"));
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
          {fromInstall && (
            <div className="mb-5 text-[13px] text-[#22C55E] bg-[#22C55E]/10 px-3 py-2.5 rounded-xl border border-[#22C55E]/20">
              ✓ Your Shopify store is connected. Create your account to see your free Store X-Ray.
            </div>
          )}
          <h1 className="text-[20px] font-bold text-white mb-1">Create your account</h1>
          <p className="text-[14px] text-white/50 mb-6">Start your free analytics dashboard</p>

          <form onSubmit={handleSignup} className="space-y-4">
            <div>
              <label className="text-[13px] font-semibold text-white/60 mb-1.5 block uppercase tracking-[0.08em]">Full Name</label>
              <input
                type="text" value={name} onChange={e => setName(e.target.value)}
                placeholder="Your name"
                className="w-full px-3.5 py-2.5 bg-white/[0.05] border border-white/[0.08] rounded-xl text-[15px] text-white focus:outline-none focus:border-[#F97316] placeholder:text-white/20 transition-colors"
                required
              />
            </div>
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
              <label className="text-[13px] font-semibold text-white/60 mb-1.5 block uppercase tracking-[0.08em]">Password</label>
              <div className="relative">
                <input
                  type={showPw ? "text" : "password"} value={password} onChange={e => setPassword(e.target.value)}
                  placeholder="Min 8 characters"
                  className="w-full px-3.5 py-2.5 bg-white/[0.05] border border-white/[0.08] rounded-xl text-[15px] text-white focus:outline-none focus:border-[#F97316] placeholder:text-white/20 transition-colors"
                  required minLength={8}
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
              {loading ? "Creating account..." : "Create account →"}
            </button>
          </form>

          <div className="mt-5 pt-4 border-t border-white/[0.06] text-center">
            <span className="text-[14px] text-white/40">Already have an account? </span>
            <Link href="/login" className="text-[14px] text-[#F97316] font-semibold hover:text-[#EA580C] transition-colors">Sign in</Link>
          </div>
        </div>

        <p className="text-center text-[12px] text-white/25 mt-5">
          By signing up you agree to our{" "}
          <Link href="/terms" className="underline hover:text-white/50 transition-colors">Terms</Link>
          {" "}and{" "}
          <Link href="/privacy" className="underline hover:text-white/50 transition-colors">Privacy Policy</Link>
        </p>
      </div>
    </div>
  );
}
