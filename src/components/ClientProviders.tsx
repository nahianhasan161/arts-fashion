"use client";

import { ReactNode } from "react";
import { ToastProvider } from "@/components/ui/toast";

export function ClientProviders({ children }: { children: ReactNode }) {
  return <ToastProvider>{children}</ToastProvider>;
}