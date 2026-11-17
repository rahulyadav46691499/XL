"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Play, Square } from "lucide-react";
import { listVoices, selectedVoice, setSelectedVoice, voicePreviewUrl, Voice } from "@/lib/api";

/** Sarvam's speaker ids are lowercase and are the wire value the TTS handshake
 *  expects, so the capital is put on the label only, never on `v.id`. */
/**
 * Which voice the AI interviewer speaks in, with a demo of each.
 *
 * A native `<select>` on purpose: it is a one-of-six choice with no search, and
 * on a phone the OS wheel beats anything hand-rolled. The roster is fetched
 * (never copied here) so it cannot offer a voice the voice service would then
 * refuse — see `listVoices`.
 *
 * The choice is a browser-wide preference (`selectedVoice`), not a prop, so
 * this same control governs both the modal's call button and the dashboard's
 * bulk call without either having to thread it through.
 *
 * Previews are synthesized on first play and cached server-side, so the first
 * click on a voice takes a second or two and every later one is instant.
 */
export default function VoicePicker({ disabled }: { disabled?: boolean }) {
  const [voices, setVoices] = useState<Voice[]>([]);
  const [fallback, setFallback] = useState("");   // the service's default, used when nothing is picked
  const [value, setValue] = useState("");
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    // localStorage is read here rather than in useState's initializer: this
    // renders on the server first, where there is no window.
    setValue(selectedVoice());
    listVoices()
      .then((data) => {
        setVoices(data.voices);
        setFallback(data.default);
        // A voice that has left the roster would otherwise sit in the picker
        // as a blank line and get every call 400'd by the voice service.
        if (selectedVoice() && !data.voices.some((v) => v.id === selectedVoice())) {
          setSelectedVoice("");
          setValue("");
        }
      })
      .catch((err) => {
        console.warn("[Voice] roster unavailable:", err);
        setError("Voice list unavailable — calls use the default voice.");
      });
  }, []);

  // Leaving a preview playing after the modal closes is somebody's laptop
  // talking to a quiet room.
  useEffect(() => () => audioRef.current?.pause(), []);

  const speaker = value || fallback;

  const handlePick = (id: string) => {
    setValue(id);
    setSelectedVoice(id);
    setError("");
    audioRef.current?.pause();
    setPlaying(false);
  };

  const handlePreview = () => {
    const audio = audioRef.current;
    if (!audio || !speaker) return;
    if (playing) {
      audio.pause();
      setPlaying(false);
      return;
    }
    setError("");
    setLoading(true);
    audio.src = voicePreviewUrl(speaker);
    audio.play().catch((err) => {
      console.warn("[Voice] preview failed:", err);
      setLoading(false);
      setError("That preview could not be played.");
    });
  };

  const female = voices.filter((v) => v.gender === "female");
  const male = voices.filter((v) => v.gender === "male");

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5">
        <label htmlFor="voice-picker" className="text-[13px] text-muted-foreground">
          Voice
        </label>
        <select
          id="voice-picker"
          value={speaker}
          disabled={disabled || voices.length === 0}
          onChange={(e) => handlePick(e.target.value)}
          title="The voice the AI interviewer speaks in on the next call"
          className="px-2.5 py-2 rounded-xl text-[15px] font-semibold bg-secondary/50 border border-border text-foreground focus:outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]/20 disabled:opacity-40"
        >
          {voices.length === 0 && <option value="">Loading voices…</option>}
          {female.length > 0 && (
            <optgroup label="Female">
              {female.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name} — {v.tone}
                </option>
              ))}
            </optgroup>
          )}
          {male.length > 0 && (
            <optgroup label="Male">
              {male.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name} — {v.tone}
                </option>
              ))}
            </optgroup>
          )}
        </select>
        <button
          type="button"
          onClick={handlePreview}
          disabled={disabled || !speaker || loading}
          title={playing ? "Stop the demo" : `Hear ${voices.find((v) => v.id === speaker)?.name ?? "this voice"} read the call's opening line`}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[15px] font-semibold text-muted-foreground hover:text-[var(--brand)] hover:bg-[var(--brand-wash)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {loading ? (
            <Loader2 size={13} className="animate-spin" />
          ) : playing ? (
            <Square size={13} className="text-[var(--brand)]" />
          ) : (
            <Play size={13} />
          )}
          {loading ? "Loading…" : playing ? "Stop" : "Demo"}
        </button>
        <audio
          ref={audioRef}
          onPlaying={() => {
            setLoading(false);
            setPlaying(true);
          }}
          onEnded={() => setPlaying(false)}
          onPause={() => setPlaying(false)}
          onError={() => {
            setLoading(false);
            setPlaying(false);
            setError("That preview could not be generated — check SARVAM_API_KEY in backend/.env.");
          }}
          className="hidden"
        />
      </div>
      {error && <p className="text-[13px] text-muted-foreground">{error}</p>}
    </div>
  );
}
