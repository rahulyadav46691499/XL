"use client";

import { useState } from "react";
import { Send, Bot, User, Loader2 } from "lucide-react";
import { chatWithAI } from "@/lib/api";
import Markdown from "@/components/Markdown";

type Msg = { id: string; role: "bot" | "user"; text: string };

export default function ChatbotPage() {
  const [messages, setMessages] = useState<Msg[]>([
    { id: "1", role: "bot", text: "Ask about any candidate screened against this job description — their skills, their gaps, or how two of them compare." },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sessionId] = useState(() => `SESSION-${Date.now().toString(36)}`);

  // An empty screen is an invitation to act. These are the three questions a
  // recruiter actually opens this page to ask, phrased the way they'd ask them.
  const starters = [
    "Who are the two strongest candidates, and why?",
    "Which must-have skills is nobody covering?",
    "Who has the most relevant hands-on experience?",
  ];

  const send = async (text?: string) => {
    const question = (text ?? input).trim();
    if (!question || loading) return;
    const userMsg: Msg = { id: crypto.randomUUID(), role: "user", text: question };
    setMessages((m) => [...m, userMsg]);
    setInput("");
    setLoading(true);

    try {
      const data = await chatWithAI(sessionId, question);
      setMessages((m) => [...m, {
        id: crypto.randomUUID(),
        role: "bot",
        text: data.response,
      }]);
    } catch (err) {
      // The old message was "Sorry, I encountered an error. Please try again."
      // for every failure — including a rejected provider key, which retrying
      // will never fix. The backend names the cause; show it.
      console.warn("[Chat] failed:", err);
      setMessages((m) => [...m, {
        id: crypto.randomUUID(),
        role: "bot",
        text: err instanceof Error ? err.message : "The assistant could not answer. Please try again.",
      }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Same header scale as Upload JD — one page-title size across the app.
          The nav calls this "Your Assistant", so the page does too. */}
      <div className="border-b border-border px-6 py-5 bg-card/50 rise">
        {/* Constrained to the same column as the conversation below, so the
            page has one left edge instead of two. */}
        <div className="max-w-3xl mx-auto w-full">
          <p className="eyebrow">Ask</p>
          <h1 className="text-[21px] font-semibold tracking-[-0.02em] text-foreground leading-[1.15] mt-1">
            Your Assistant
          </h1>
          <p className="text-[13px] text-muted-foreground mt-1">
            Describe what you need and get the best fits for it.
          </p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-4 max-w-3xl mx-auto w-full">
        {messages.map((m) => (
          <div key={m.id} className={`flex gap-3 ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            {m.role === "bot" && (
              <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: "linear-gradient(135deg, var(--brand), var(--brand-strong))" }}>
                <Bot size={15} className="text-white" />
              </div>
            )}
            <div className={`min-w-0 px-4 py-2.5 rounded-2xl text-[15px] ${
              m.role === "user" ? "max-w-[70%] bg-[var(--brand)] text-white" : "max-w-[85%] bg-secondary text-foreground"
            }`}>
              {m.role === "bot" ? <Markdown text={m.text} /> : m.text}
            </div>
            {m.role === "user" && (
              <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center flex-shrink-0">
                <User size={15} className="text-foreground/70" />
              </div>
            )}
          </div>
        ))}
        {loading && (
          <div className="flex justify-start gap-3">
            <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: "linear-gradient(135deg, var(--brand), var(--brand-strong))" }}>
              <Bot size={15} className="text-white" />
            </div>
            <div className="px-4 py-2.5 rounded-2xl bg-secondary text-foreground flex items-center gap-2">
              <Loader2 size={14} className="animate-spin text-[var(--brand)]" />
              <span className="text-[15px] text-muted-foreground">Reading the resumes…</span>
            </div>
          </div>
        )}

        {/* Starters only while the conversation is still empty. */}
        {messages.length === 1 && !loading && (
          <div className="pl-11 pt-1 rise" style={{ animationDelay: "120ms" }}>
            <p className="eyebrow mb-2">Start with</p>
            <div className="flex flex-col items-start gap-1.5">
              {starters.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="text-left text-[13px] px-3 py-2 rounded-xl border border-border bg-card hover:border-[var(--brand)] hover:bg-secondary/60 transition-all active:scale-[0.99]"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-border p-4 max-w-3xl mx-auto w-full">
        <div className="flex items-center gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
            placeholder="Ask about a candidate…"
            aria-label="Ask about a candidate"
            className="flex-1 px-4 py-2.5 text-[15px] rounded-xl border border-border bg-secondary/50 focus:border-[var(--brand)]"
            disabled={loading}
          />
          <button
            onClick={() => send()}
            disabled={loading || !input.trim()}
            aria-label="Send question"
            className="w-10 h-10 rounded-xl flex items-center justify-center text-white flex-shrink-0 disabled:opacity-50 transition-opacity"
            style={{ background: "linear-gradient(135deg, var(--brand), var(--brand-strong))" }}
          >
            {loading ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
          </button>
        </div>
      </div>
    </div>
  );
}
