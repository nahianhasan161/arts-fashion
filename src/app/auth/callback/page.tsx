"use client";

import React, { useState, useEffect, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { ArrowRight, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import Link from "next/link";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { getSafeRedirectPath } from "@/lib/auth/redirect";

function OAuthCallbackContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const [status, setStatus] = useState("pending");
  const [error, setError] = useState<string | null>(null);

  const code = searchParams.get("code");
  const next = searchParams.get("next") || "/account";
  const safeRedirectTo = getSafeRedirectPath(next);

  useEffect(() => {
    const handleOAuthCallback = async () => {
      try {
        const supabase = getSupabaseBrowserClient();

        if (!supabase) {
          setError("Supabase authentication is not configured.");
          setStatus("error");
          return;
        }

        if (!code) {
          setError("Authorization code not found in URL.");
          setStatus("error");
          return;
        }

        setStatus("processing");

        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);

        if (exchangeError) {
          setError(exchangeError.message);
          setStatus("error");
          return;
        }

        setStatus("success");

        setTimeout(() => {
          router.push(safeRedirectTo);
        }, 2000);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "An unexpected error occurred.");
        setStatus("error");
      }
    };

    if (code) {
      handleOAuthCallback();
    } else {
      setError("Authorization code not found in URL.");
      setStatus("error");
    }
  }, [code, router, safeRedirectTo]);

  if (status === "pending" || status === "processing") {
    return (
      <div className="min-h-[calc(100vh-120px)] lg:min-h-[calc(100vh-164px)] flex items-center justify-center px-space-base">
        <div className="bg-surface-card border border-border-light rounded-2xl p-space-xl max-w-md w-full text-center shadow-lg">
          <div className="w-16 h-16 rounded-full bg-accent-gold-soft flex items-center justify-center mx-auto mb-4">
            {status === "pending" ? (
              <Loader2 className="w-8 h-8 text-accent-gold animate-spin" />
            ) : (
              <Loader2 className="w-8 h-8 text-accent-gold animate-spin" />
            )}
          </div>

          <h1 className="font-display text-2xl uppercase tracking-wider font-bold text-primary mb-2">
            {status === "pending" ? "Waiting for authorization..." : "Processing sign-in..."}
          </h1>

          <p className="text-xs text-text-muted">
            {status === "pending"
              ? "Please complete the authorization in the popup window."
              : "Finishing the sign-in process..."}
          </p>
        </div>
      </div>
    );
  }

  if (status === "success") {
    return (
      <div className="min-h-[calc(100vh-120px)] lg:min-h-[calc(100vh-164px)] flex items-center justify-center px-space-base">
        <div className="bg-surface-card border border-border-light rounded-2xl p-space-xl max-w-md w-full text-center shadow-lg">
          <div className="w-16 h-16 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto mb-4">
            <CheckCircle2 className="w-8 h-8" />
          </div>

          <h1 className="font-display text-2xl uppercase tracking-wider font-bold text-primary mb-2">
            Successfully signed in!
          </h1>

          <p className="text-xs text-text-muted mb-6">
            You&#39;re being redirected to your account...
          </p>

          <Link
            href={safeRedirectTo}
            className="inline-flex items-center gap-2 px-6 py-3 bg-primary text-white font-display uppercase tracking-wider text-xs font-bold rounded-lg hover:bg-primary-container transition-colors shadow-sm"
          >
            <span>Go to Account</span>
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="min-h-[calc(100vh-120px)] lg:min-h-[calc(100vh-164px)] flex items-center justify-center px-space-base">
        <div className="bg-surface-card border border-border-light rounded-2xl p-space-xl max-w-md w-full text-center shadow-lg">
          <div className="w-16 h-16 rounded-full bg-red-100 text-red-600 flex items-center justify-center mx-auto mb-4">
            <AlertCircle className="w-8 h-8" />
          </div>

          <h1 className="font-display text-2xl uppercase tracking-wider font-bold text-primary mb-2">
            Sign-in failed
          </h1>

          <p className="text-xs text-text-muted mb-2">
            We encountered an error while processing your sign-in.
          </p>

          <p className="text-[11px] text-badge-discount font-medium bg-badge-discount/10 rounded-lg p-3 mb-6">
            {error}
          </p>

          <div className="flex flex-col gap-3">
            <Link
              href="/sign-in"
              className="px-6 py-3 bg-primary text-white font-display uppercase tracking-wider text-xs font-bold rounded-lg hover:bg-primary-container transition-colors shadow-sm"
            >
              Try Again
            </Link>

            <Link
              href="/"
              className="text-xs text-text-muted hover:text-primary transition-colors"
            >
              Return to Home
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return null;
}

export default function AuthCallbackPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-[calc(100vh-120px)] lg:min-h-[calc(100vh-164px)] flex items-center justify-center px-space-base">
          <Loader2 className="w-8 h-8 text-accent-gold animate-spin" />
        </div>
      }
    >
      <OAuthCallbackContent />
    </Suspense>
  );
}
