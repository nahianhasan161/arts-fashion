"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, Eye, EyeOff, Loader2, LockKeyhole, Mail } from "lucide-react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { getSafeRedirectPath } from "@/lib/auth/redirect";
import { GoogleSignInButton } from "@/components/auth/GoogleSignInButton";

export function SignInForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnTo = getSafeRedirectPath(searchParams.get("next"));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setPending(true);

    try {
      const supabase = getSupabaseBrowserClient();

      if (!supabase) {
        throw new Error("Supabase authentication is not configured.");
      }

      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (signInError) throw signInError;
      router.replace(returnTo);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to sign in.");
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex flex-col gap-space-base">
      <div className="lg:hidden text-center mb-space-base">
        <p className="font-display uppercase text-xs tracking-[0.2em] text-accent-gold font-bold">
          Welcome back
        </p>
        <h1 className="font-display text-2xl uppercase text-primary font-bold mt-1">
          Sign in to your account
        </h1>
        <p className="text-xs text-text-muted mt-2">
          Access your orders, saved details, and faster checkout.
        </p>
      </div>

      <GoogleSignInButton returnTo={returnTo} />

      <div className="flex items-center gap-space-base text-[10px] uppercase tracking-wider text-text-muted">
        <span className="h-px flex-1 bg-border-light"></span>
        <span>or sign in with email</span>
        <span className="h-px flex-1 bg-border-light"></span>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-space-base">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="sign-in-email" className="text-xs font-semibold text-on-surface">
            Email address
          </label>
          <div className="relative">
            <Mail className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
            <input
              id="sign-in-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              placeholder="name@example.com"
              required
              className="w-full h-11 pl-9 pr-3 rounded-lg border border-border-light bg-surface-subtle text-sm text-on-surface placeholder:text-text-muted focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 transition-all"
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="sign-in-password" className="text-xs font-semibold text-on-surface">
            Password
          </label>
          <div className="relative">
            <LockKeyhole className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
            <input
              id="sign-in-password"
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              placeholder="Enter your password"
              required
              className="w-full h-11 pl-9 pr-10 rounded-lg border border-border-light bg-surface-subtle text-sm text-on-surface placeholder:text-text-muted focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 transition-all"
            />
            <button
              type="button"
              onClick={() => setShowPassword((current) => !current)}
              aria-label={showPassword ? "Hide password" : "Show password"}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-primary transition-colors"
            >
              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {error && (
          <p className="text-[11px] leading-5 text-badge-discount" role="alert">
            {error}
          </p>
        )}
        {searchParams.get("error") && (
          <p className="text-[11px] leading-5 text-badge-discount" role="alert">
            {searchParams.get("error")}
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="w-full h-11 bg-primary text-white font-display uppercase tracking-wider text-xs font-bold rounded-lg hover:bg-primary-container transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-sm"
        >
          {pending ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Signing in...
            </>
          ) : (
            <>
              Sign in
              <ArrowRight className="w-4 h-4" />
            </>
          )}
        </button>
      </form>

      <Link
        href="#"
        className="text-center text-xs text-secondary font-bold hover:text-primary transition-colors"
      >
        Forgot your password?
      </Link>
    </div>
  );
}
