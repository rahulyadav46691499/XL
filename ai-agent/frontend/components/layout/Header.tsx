"use client";

import { useTheme } from "next-themes";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Sun, Moon, Bell, ChevronDown, LogOut, Settings, User, Upload, LayoutDashboard, BarChart3, Sparkles, Lock, Plus, Trash2, X, Key } from "lucide-react";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Logo from "@/components/Logo";
import { useAppState } from "@/lib/app-state";
import { cn } from "@/lib/utils";
import { getLlmConfig, saveLlmConfig, deleteLlmProvider, LlmProvider, LlmConfig } from "@/lib/api";

export default function Header() {
  const { theme, setTheme } = useTheme();
  const router = useRouter();
  const { resetApp, hasAnalyzed } = useAppState();
  const pathname = usePathname();
  const [userOpen, setUserOpen] = useState(false);
  const [llmOpen, setLlmOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const isDark = theme === "dark";

  const [llmConfig, setLlmConfig] = useState<LlmConfig | null>(null);
  const [addingProvider, setAddingProvider] = useState(false);
  const [newProviderName, setNewProviderName] = useState("");
  const [newProviderKey, setNewProviderKey] = useState("");
  const [newModelName, setNewModelName] = useState("");
  const [newModelId, setNewModelId] = useState("");
  const [savingProvider, setSavingProvider] = useState(false);

  const loadLlmConfig = async () => {
    try {
      const cfg = await getLlmConfig();
      setLlmConfig(cfg);
    } catch (e) {
      console.error("Failed to load LLM config", e);
    }
  };

  useEffect(() => {
    loadLlmConfig();
  }, []);

  const handleAddProvider = async () => {
    if (!newProviderName.trim() || !newProviderKey.trim()) return;
    setSavingProvider(true);
    try {
      const current = llmConfig || await getLlmConfig();
      const id = newProviderName.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      const newProvider: LlmProvider = {
        id,
        name: newProviderName.trim(),
        apiKey: newProviderKey.trim(),
        models: newModelId.trim() ? [{ id: newModelId.trim(), name: newModelName.trim() || newModelId.trim() }] : [],
      };
      const updated = {
        ...current,
        providers: [...current.providers, newProvider],
      };
      const saved = await saveLlmConfig(updated);
      setLlmConfig(saved);
      setNewProviderName("");
      setNewProviderKey("");
      setNewModelName("");
      setNewModelId("");
      setAddingProvider(false);
    } catch (e) {
      console.error("Failed to add provider", e);
    } finally {
      setSavingProvider(false);
    }
  };

  const handleDeleteProvider = async (providerId: string) => {
    try {
      const saved = await deleteLlmProvider(providerId);
      setLlmConfig(saved);
    } catch (e) {
      console.error("Failed to delete provider", e);
    }
  };

  // Dashboard leads: it is where login lands, so it is never locked — a landing
  // page you cannot navigate back to would be a dead end. With no screening yet
  // it shows its own empty state pointing at Upload JD. The AI Assistant stays
  // locked because it has nothing to answer questions about until then.
  //
  // Collective analysis sits second, directly after the table it summarises and
  // before Upload JD, and is locked on the same rule as the assistant: it is
  // entirely made of cohort figures, so with no cohort it is a page of em
  // dashes.
  const navItems = [
    { href: "/dashboard", icon: LayoutDashboard, label: "Dashboard", locked: false },
    { href: "/analysis", icon: BarChart3, label: "Collective Analysis", locked: !hasAnalyzed },
    { href: "/upload", icon: Upload, label: "Upload JD", locked: false },
    { href: "/chatbot", icon: Sparkles, label: "Your Assistant", locked: !hasAnalyzed },
  ];

  return (
    <header className="h-[88px] border-b border-border bg-[hsl(var(--topbar))] flex items-center justify-between px-6 flex-shrink-0 z-40 relative">
      <div className="flex items-center gap-7">
        {/* One line — "EXL Candidate Intelligence" was removed on request; the
            EXL mark itself carries that, and the product name sits on its
            baseline. */}
        <Logo size={48} onClick={() => { resetApp(); router.push("/dashboard"); }} />
        <nav className="hidden md:flex items-center gap-1">
          {navItems.map(({ href, icon: Icon, label, locked }) => {
            const active = pathname === href;
            if (locked) {
              return (
                <div
                  key={href}
                  title="Add resumes to a job description first to unlock"
                  className="flex items-center gap-2 px-5 py-3 rounded-lg text-[17px] font-semibold text-muted-foreground/40 cursor-not-allowed select-none"
                >
                  <Icon size={19} />
                  {label}
                  <Lock size={15} />
                </div>
              );
            }
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  "flex items-center gap-2 px-5 py-3 rounded-lg text-[17px] font-semibold transition-all",
                  active ? "text-white shadow-md" : "text-muted-foreground hover:text-foreground hover:bg-secondary"
                )}
                style={active ? { background: "linear-gradient(135deg, var(--brand), var(--brand-strong))", boxShadow: "0 4px 12px var(--brand-wash)" } : {}}
              >
                <Icon size={19} />
                {label}
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="flex items-center gap-2">
        <button onClick={() => setTheme(isDark ? "light" : "dark")}
          className="w-10 h-10 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors" aria-label="Toggle theme">
          {mounted ? (isDark ? <Sun size={18} /> : <Moon size={18} />) : <Moon size={18} />}
        </button>

        <button className="w-10 h-10 rounded-lg relative flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
          <Bell size={18} />
          <span className="absolute top-2 right-2 w-1.5 h-1.5 rounded-full bg-[var(--brand)]" />
        </button>

        <div className="w-px h-6 bg-border mx-1.5" />

        <div className="relative">
          <button onClick={() => { setUserOpen(!userOpen); setLlmOpen(false); }} className="flex items-center gap-2 pl-1.5 pr-3 py-1.5 rounded-xl hover:bg-secondary transition-colors">
            <div className="w-9 h-9 rounded-full flex items-center justify-center text-white text-[13px] font-bold" style={{ background: "linear-gradient(135deg, var(--brand), var(--brand-strong))" }}>RD</div>
            <div className="hidden sm:block text-left">
              <p className="text-[15px] font-semibold text-foreground leading-none">HR Manager</p>
            </div>
            <ChevronDown size={14} className="text-muted-foreground" />
          </button>

          {userOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setUserOpen(false)} />
              <div className="absolute right-0 top-full mt-1.5 w-64 bg-card border border-border rounded-xl shadow-xl z-50 py-1 overflow-hidden">
                <div className="px-3 py-2.5 border-b border-border">
                  <p className="text-[13px] font-semibold text-foreground">HR Manager</p>
                  <p className="text-[13px] text-muted-foreground">recruitment@exlservice.com</p>
                </div>

                <div className="border-t border-border mt-1" />
                <button
                  onClick={() => { setUserOpen(false); setLlmOpen(true); }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] text-foreground/80 hover:bg-secondary transition-colors text-left"
                >
                  <Key size={13} className="text-muted-foreground" />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">API Configurations</p>
                    <p className="text-[11px] text-muted-foreground truncate">
                      {llmConfig ? `${llmConfig.providers.length} provider(s)` : "Loading…"}
                    </p>
                  </div>
                  <ChevronDown size={11} className={cn("transition-transform", llmOpen && "rotate-180")} />
                </button>

                {[{ icon: User, label: "Profile" }, { icon: Settings, label: "Settings" }].map(({ icon: Icon, label }) => (
                  <button key={label} className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] text-foreground/80 hover:bg-secondary transition-colors text-left">
                    <Icon size={13} className="text-muted-foreground" />{label}
                  </button>
                ))}
                <div className="border-t border-border mt-1" />
                <button onClick={() => { localStorage.removeItem("exl_access_token"); resetApp(); router.push("/login"); }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] text-[var(--danger)] hover:bg-[var(--danger)]/10 transition-colors text-left mt-1">
                  <LogOut size={13} />Sign out
                </button>
              </div>
            </>
          )}

          {llmOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setLlmOpen(false)} />
              <div className="absolute right-0 top-full mt-1.5 w-80 bg-card border border-border rounded-xl shadow-xl z-50 py-2 overflow-hidden">
                <div className="px-3 py-2 border-b border-border flex items-center justify-between">
                  <div>
                    <p className="text-[13px] font-semibold text-foreground">API Configurations</p>
                    <p className="text-[11px] text-muted-foreground">Manage LLM providers & keys</p>
                  </div>
                  <button
                    onClick={() => setAddingProvider(!addingProvider)}
                    className="w-6 h-6 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                    title="Add new provider"
                  >
                    {addingProvider ? <X size={13} /> : <Plus size={13} />}
                  </button>
                </div>

                {addingProvider && (
                  <div className="px-3 py-2.5 border-b border-border space-y-2 bg-secondary/30">
                    <div>
                      <label className="text-[11px] font-medium text-muted-foreground block mb-1">Provider Name</label>
                      <input
                        value={newProviderName}
                        onChange={(e) => setNewProviderName(e.target.value)}
                        placeholder="e.g. OpenAI, Cohere"
                        className="w-full px-2.5 py-1.5 text-[13px] rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-[var(--brand)]"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] font-medium text-muted-foreground block mb-1">API Key</label>
                      <input
                        type="password"
                        value={newProviderKey}
                        onChange={(e) => setNewProviderKey(e.target.value)}
                        placeholder="Enter API key"
                        className="w-full px-2.5 py-1.5 text-[13px] rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-[var(--brand)]"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[11px] font-medium text-muted-foreground block mb-1">Model ID</label>
                        <input
                          value={newModelId}
                          onChange={(e) => setNewModelId(e.target.value)}
                          placeholder="e.g. gpt-4o"
                          className="w-full px-2.5 py-1.5 text-[13px] rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-[var(--brand)]"
                        />
                      </div>
                      <div>
                        <label className="text-[11px] font-medium text-muted-foreground block mb-1">Model Name</label>
                        <input
                          value={newModelName}
                          onChange={(e) => setNewModelName(e.target.value)}
                          placeholder="e.g. GPT-4o"
                          className="w-full px-2.5 py-1.5 text-[13px] rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-[var(--brand)]"
                        />
                      </div>
                    </div>
                    <button
                      onClick={handleAddProvider}
                      disabled={savingProvider || !newProviderName.trim() || !newProviderKey.trim()}
                      className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-white text-[13px] font-semibold transition-all disabled:opacity-40"
                      style={{ background: "linear-gradient(135deg, var(--brand), var(--brand-strong))" }}
                    >
                      {savingProvider ? "Saving…" : <><Plus size={11} /> Add Provider</>}
                    </button>
                  </div>
                )}

                <div className="max-h-72 overflow-y-auto">
                  {llmConfig?.providers.map((provider) => (
                    <div key={provider.id} className="px-3 py-2 hover:bg-secondary/60 transition-colors">
                      <div className="flex items-center justify-between">
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-semibold text-foreground truncate">{provider.name}</p>
                          <p className="text-[11px] text-muted-foreground font-mono truncate">
                            {provider.apiKey.length > 8 ? provider.apiKey.slice(0, 8) + "..." : provider.apiKey}
                          </p>
                        </div>
                        <button
                          onClick={() => handleDeleteProvider(provider.id)}
                          className="ml-2 w-5 h-5 rounded flex items-center justify-center text-muted-foreground hover:text-[var(--danger)] hover:bg-[var(--danger)]/10 transition-colors"
                          title="Remove provider"
                        >
                          <Trash2 size={10} />
                        </button>
                      </div>
                      {provider.models.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {provider.models.map((model) => (
                            <span key={model.id} className="text-[11px] px-1.5 py-0.5 rounded-md bg-secondary border border-border text-muted-foreground">
                              {model.name || model.id}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                  {(!llmConfig || llmConfig.providers.length === 0) && (
                    <div className="px-3 py-4 text-center">
                      <p className="text-[13px] text-muted-foreground">No API providers configured</p>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}