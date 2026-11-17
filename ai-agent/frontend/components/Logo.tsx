"use client";

import Image from "next/image";
import { useState } from "react";
import { cn } from "@/lib/utils";

// If your logo file is named differently, change this line:
const LOGO_SRC = "/EXL_Logo.png";

export default function Logo({
  size = 32,
  showText = true,
  subtitle = "",
  onClick,
}: {
  size?: number;
  showText?: boolean;
  /** Optional second line. Empty by default — the product name is one line,
   *  set on the same baseline as the EXL mark beside it. */
  subtitle?: string;
  onClick?: () => void;
}) {
  const [errored, setErrored] = useState(false);

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-2.5 bg-transparent border-none p-0 cursor-pointer",
        onClick ? "hover:opacity-80 transition-opacity" : "cursor-default"
      )}
    >
      {errored ? (
        <div
          className="rounded-lg flex items-center justify-center text-white font-black shadow-md flex-shrink-0"
          style={{
            width: size, height: size,
            background: "linear-gradient(135deg, var(--brand), var(--brand-strong))",
            fontSize: size * 0.34,
          }}
        >
          EXL
        </div>
      ) : (
        <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
        <Image src={LOGO_SRC} alt="EXL" fill sizes={`${size}px`} className="object-contain"
          onError={() => setErrored(true)} priority />
      </div>
      )}
      {showText && (
        <div>
          <p className="text-[21px] font-bold text-foreground leading-none tracking-[-0.01em]">
            TalentAgent AI Suite
          </p>
          {subtitle && <p className="text-[11px] text-muted-foreground leading-none mt-0.5">{subtitle}</p>}
        </div>
      )}
    </button>
  );
}