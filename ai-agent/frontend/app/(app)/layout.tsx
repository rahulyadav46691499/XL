"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Header from "@/components/layout/Header";
import { AppStateProvider } from "@/lib/app-state";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();

  useEffect(() => {
    const token = typeof window !== "undefined" ? localStorage.getItem("exl_access_token") : null;
    if (!token) {
      router.push("/login");
    }
  }, [router]);

  return (
    <AppStateProvider>
      <div className="flex flex-col h-screen overflow-hidden bg-background">
        <Header />
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </AppStateProvider>
  );
}