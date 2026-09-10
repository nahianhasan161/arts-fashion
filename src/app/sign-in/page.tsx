"use client";

import React, { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Mail, LockKeyhole, Eye, EyeOff } from "lucide-react";
import { AuthLayout } from "@/components/auth/AuthLayout";
import { GoogleSignInButton } from "@/components/auth/GoogleSignInButton";
import { getSafeRedirectPath } from "@/lib/auth/redirect";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

type SignInForm = {
  email: string;
  password: string;
};

export default function SignInPage() {
  const router = useRouter();
  const [form, setForm] = useState<SignInForm>({ email: "", password: "" });
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [returnTo, setReturnTo] = useState<string | null>(null);

  React.useEffect(() => {
    if (typeof window !== 'undefined') {
      const searchParams = new URLSearchParams(window.location.search);
      setReturnTo(getSafeRedirectPath(searchParams.get("next") || null));
    }
  }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const supabase = getSupabaseBrowserClient();

    if (!supabase) {
      setError("Supabase authentication is not configured.");
      setLoading(false);
      return;
    }

    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: form.email,
        password: form.password,
      });

      if (signInError) {
        if (signInError.message.includes("Invalid login credentials")) {
          setError("Invalid email or password.");
        } else {
          setError(signInError.message);
        }
        return;
      }

      router.refresh();
      router.push(returnTo || "/account");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "An unexpected error occurred.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout
      title="Welcome Back"
      description="Sign in to your account to continue shopping and manage your orders."
      footerText="Don&#39;t have an account yet?"
      footerLinkLabel="Create Account"
      footerLinkHref="/sign-up"
    >
      <div className="mb-space-xl">
        <h2 className="font-display text-2xl uppercase tracking-wider font-bold text-primary mb-1">
          Sign In
        </h2>
        <p className="text-xs text-text-muted">Access your Arts Fashion account</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-space-base">
        {error && (
          <div className="bg-badge-discount/10 border border-badge-discount/30 rounded-lg p-space-base">
            <p className="text-[11px] font-medium text-badge-discount">{error}</p>
          </div>
        )}

        <div className="space-y-1.5">
          <label className="block text-xs font-semibold text-on-surface">Email Address</label>
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
            <input
              type="email"
              required
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder="your.email@example.com"
              className="w-full h-10 pl-9 pr-3 border border-border-light rounded-lg text-xs font-medium focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 transition-colors"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="block text-xs font-semibold text-on-surface">Password</label>
          <div className="relative">
            <LockKeyhole className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
            <input
              type={showPassword ? "text" : "password"}
              required
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              placeholder="Enter your password"
              className="w-full h-10 pl-9 pr-10 border border-border-light rounded-lg text-xs font-medium focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 transition-colors"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-text-muted hover:text-primary transition-colors"
            >
              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>

        <div className="text-right -mt-1">
          <Link href="#" className="text-[10px] text-secondary hover:text-primary transition-colors">
            Forgot password?
          </Link>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full h-11 bg-primary hover:bg-primary-container text-white font-display uppercase tracking-wider text-xs font-bold rounded-lg transition-colors active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? "Signing In..." : "Sign In"}
        </button>
      </form>

      <div className="relative my-space-base">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-border-light" />
        </div>
        <div className="relative flex justify-center text-xs uppercase text-text-muted">
          <span className="bg-surface-card px-3">Or continue with</span>
        </div>
      </div>

      <GoogleSignInButton returnTo={returnTo ?? undefined} />
    </AuthLayout>
  );
}
