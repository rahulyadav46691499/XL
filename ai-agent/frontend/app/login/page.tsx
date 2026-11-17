"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, User, Lock } from "lucide-react";
import Logo from "@/components/Logo";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [remember, setRemember] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const token = localStorage.getItem("exl_access_token");
    if (token) {
      router.push("/dashboard");
    }
  }, [router]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      if (username === "Admin" && password === "EXL123") {
        localStorage.setItem("exl_access_token", "authenticated");
        if (remember) localStorage.setItem("exl_remember_username", username);
        router.push("/dashboard");
      } else {
        setError("Invalid username or password");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="w-full max-w-5xl grid lg:grid-cols-2 rounded-3xl overflow-hidden border border-border shadow-2xl"
        style={{ minHeight: "580px" }}>

        {/* LEFT: Form */}
        <div className="relative flex flex-col justify-center px-8 sm:px-14 py-12 bg-card">

          {/* Form block */}
          <div className="w-full max-w-[350px] mx-auto">

            {/* Brand — aligned with form, bigger logo */}
            <div className="flex items-center gap-3 mb-8">
              <Logo size={72} showText={false} />
              <span className="text-[17px] font-semibold text-foreground tracking-tight">
                TalentAgent AI
              </span>
            </div>

            <div className="mb-7">
              <h1 className="text-[26px] font-bold text-foreground leading-tight tracking-tight">
                Welcome back 👋
              </h1>
            </div>

            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="text-[13px] font-semibold text-foreground mb-1.5 block">Username</label>
                <div className="relative">
                  <User size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input type="text" placeholder="Enter your username" value={username} onChange={(e) => setUsername(e.target.value)}
                    className="w-full pl-9 pr-4 py-2.5 text-[15px] rounded-xl border border-border bg-secondary text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]/20 transition-all" />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-[13px] font-semibold text-foreground">Password</label>
                  <button type="button" className="text-[13px] font-medium" style={{ color: "var(--brand)" }}>Forgot password?</button>
                </div>
                <div className="relative">
                  <Lock size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input type={show ? "text" : "password"} placeholder="••••••••••" value={password} onChange={(e) => setPassword(e.target.value)}
                    className="w-full pl-9 pr-10 py-2.5 text-[15px] rounded-xl border border-border bg-secondary text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]/20 transition-all" />
                  <button type="button" onClick={() => setShow(!show)} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                    {show ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>

              {error && <p className="text-[13px] text-[var(--danger)]">{error}</p>}

              <label className="flex items-center gap-2.5 cursor-pointer pt-1">
                <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)}
                  className="w-4 h-4 rounded accent-[var(--brand)]" />
                <span className="text-[13px] text-muted-foreground">Remember me</span>
              </label>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 mt-2 rounded-xl text-white text-[15px] font-semibold flex items-center justify-center gap-2 transition-all active:scale-[0.98]"
                style={{ background: loading ? "var(--brand-wash)" : "linear-gradient(135deg, var(--brand), var(--brand-strong))", boxShadow: "0 4px 20px var(--brand-wash)" }}>
                {loading ? "Signing in…" : "Sign in"}
              </button>
            </form>

            <p className="text-center text-[13px] text-muted-foreground mt-6">
              All rights reserved · EXL @2026
            </p>
          </div>
        </div>

        {/* RIGHT: Minimal dark hiring panel */}
        <div className="hidden lg:flex relative overflow-hidden items-center justify-center p-10 bg-[#0a0b0f]">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[320px] h-[320px] rounded-full opacity-[0.13] pointer-events-none"
            style={{ background: "radial-gradient(circle, var(--brand) 0%, transparent 70%)" }} />
          <div className="absolute inset-0 opacity-[0.03]"
            style={{ backgroundImage: "radial-gradient(circle, #fff 1px, transparent 1px)", backgroundSize: "26px 26px" }} />

          <div className="relative z-10 flex flex-col items-center text-center">
          <svg
  className="w-[420px] h-[420px] animate-float"
  viewBox="0 0 300 300"
  fill="none"
>
              <rect x="90" y="35" width="150" height="210" rx="22" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.12)" strokeWidth="1.5" />
              <circle cx="165" cy="90" r="26" fill="rgba(255,255,255,0.1)" />
              <circle cx="165" cy="82" r="9" fill="rgba(255,255,255,0.55)" />
              <path d="M150 102 Q165 88 180 102 L180 110 Q165 114 150 110 Z" fill="rgba(255,255,255,0.55)" />
              <rect x="118" y="132" width="94" height="7" rx="3.5" fill="rgba(255,255,255,0.12)" />
              <rect x="118" y="132" width="76" height="7" rx="3.5" fill="var(--brand)" />
              <rect x="118" y="148" width="94" height="7" rx="3.5" fill="rgba(255,255,255,0.12)" />
              <rect x="118" y="148" width="58" height="7" rx="3.5" fill="#34d399" />
              <rect x="118" y="164" width="94" height="7" rx="3.5" fill="rgba(255,255,255,0.12)" />
              <rect x="118" y="164" width="42" height="7" rx="3.5" fill="#a855f7" />
              <circle cx="210" cy="60" r="20" fill="#fff" />
              <path d="M201 60 l6 6 l11 -12" stroke="#10b981" strokeWidth="3.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx="120" cy="205" r="18" fill="none" stroke="var(--brand)" strokeWidth="4" />
              <line x1="133" y1="218" x2="146" y2="231" stroke="var(--brand)" strokeWidth="4" strokeLinecap="round" />
              <path d="M225 175 l3 8 l8 3 l-8 3 l-3 8 l-3 -8 l-8 -3 l8 -3 z" fill="rgba(255,255,255,0.4)" />
            </svg>

            
            <p className="text-white/45 text-[15px] leading-relaxed max-w-[260px]">
              Screen resumes, score candidates, and surface the best talent — automatically, in seconds.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
