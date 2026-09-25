"use client";

import { useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

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
      const origin = window.location.origin;
      const callbackUrl = `${origin}/api/auth/callback?next=${encodeURIComponent(returnTo)}`;
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
      <Button
        type="button"
        onClick={handleGoogleSignIn}
        disabled={pending}
        variant="outline"
        className="w-full h-11"
      >
        {pending ? "Connecting to Google..." : "Continue with Google"}
      </Button>
      {error && (
        <p className="text-[11px] leading-5 text-badge-discount mt-2" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
