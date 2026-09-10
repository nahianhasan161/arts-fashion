"use client";

import React, { useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

type GoogleSignInButtonProps = {
  returnTo?: string;
  onPending?: (pending: boolean) => void;
};

export function GoogleSignInButton({
  returnTo = "/account",
  onPending,
}: GoogleSignInButtonProps) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const handleGoogleSignIn = async () => {
    const supabase = getSupabaseBrowserClient();
    setError(null);

    if (!supabase) {
      setError("Supabase authentication is not configured.");
      return;
    }

    setPending(true);
    onPending?.(true);

    try {
      const callbackUrl = `${window.location.origin}/auth/callback?next=${encodeURIComponent(returnTo)}`;
      const { data, error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: callbackUrl,
        },
      });

      if (oauthError) throw oauthError;
      if (data.url) {
        window.location.assign(data.url);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to continue with Google.");
    } finally {
      setPending(false);
      onPending?.(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={handleGoogleSignIn}
        disabled={pending}
        className="w-full h-11 flex items-center justify-center gap-2.5 border border-border-light rounded-lg bg-white text-on-surface font-semibold text-sm hover:bg-surface-subtle hover:border-primary/30 hover:shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <svg className="w-4.5 h-4.5 w-5 h-5" viewBox="0 0 24 24" aria-hidden="true">
          <path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.4-.18-2.07H12v3.93h5.38a4.6 4.6 0 0 1-2 3.02v2.53h3.24c1.9-1.75 2.98-4.32 2.98-7.41Z" />
          <path fill="#34A853" d="M12 22c2.7 0 4.97-.9 6.62-2.42l-3.24-2.53c-.89.6-2.04.95-3.38.95-2.6 0-4.8-1.76-5.58-4.12H4.08v2.6A10 10 0 0 0 12 22Z" />
          <path fill="#FBBC05" d="M6.42 13.88A5.97 5.97 0 0 1 6.12 12c0-.65.11-1.28.3-1.88V7.52H4.08a10 10 0 0 0 0 9l2.34-2.64Z" />
          <path fill="#EA4335" d="M12 6c1.47 0 2.79.51 3.83 1.5l2.87-2.87A9.72 9.72 0 0 0 12 2a10 10 0 0 0-7.92 5.52l2.34 2.64C7.2 7.76 9.4 6 12 6Z" />
        </svg>
        <span>{pending ? "Connecting to Google..." : "Continue with Google"}</span>
      </button>
      {error && (
        <p className="text-[11px] leading-5 text-badge-discount mt-2" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
