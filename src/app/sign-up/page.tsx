"use client";

import React, { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Mail, LockKeyhole, Eye, EyeOff, User } from "lucide-react";
import { AuthLayout } from "@/components/auth/AuthLayout";
import { GoogleSignInButton } from "@/components/auth/GoogleSignInButton";
import { getSafeRedirectPath } from "@/lib/auth/redirect";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

type SignUpForm = {
  name: string;
  email: string;
  password: string;
  confirmPassword: string;
};

export default function SignUpPage() {
  const router = useRouter();
  const [form, setForm] = useState<SignUpForm>({
    name: "",
    email: "",
    password: "",
    confirmPassword: "",
  });
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [returnTo, setReturnTo] = useState<string | null>(null);
  const [origin, setOrigin] = useState<string | null>(null);

  React.useEffect(() => {
    if (typeof window !== 'undefined') {
      const searchParams = new URLSearchParams(window.location.search);
      setReturnTo(getSafeRedirectPath(searchParams.get("next") || null));
      setOrigin(window.location.origin);
    }
  }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    if (form.password !== form.confirmPassword) {
      setError("Passwords do not match.");
      setLoading(false);
      return;
    }

    if (form.password.length < 8) {
      setError("Password must be at least 8 characters long.");
      setLoading(false);
      return;
    }

    const supabase = getSupabaseBrowserClient();

    if (!supabase) {
      setError("Supabase authentication is not configured.");
      setLoading(false);
      return;
    }

    try {
      const { error: signUpError } = await supabase.auth.signUp({
        email: form.email,
        password: form.password,
        options: {
          data: {
            full_name: form.name,
          },
          emailRedirectTo: `${origin || ''}/api/auth/callback?next=${encodeURIComponent(returnTo || '')}`,
        },
      });

      if (signUpError) {
        if (signUpError.message.includes("already registered")) {
          setError("This email address is already registered. Try signing in instead.");
        } else {
          setError(signUpError.message);
        }
        return;
      }

      router.push("/sign-in?message=Check your email for confirmation link");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "An unexpected error occurred.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout
      title="Create Account"
      description="Join Arts Fashion today to enjoy exclusive benefits and track your orders easily."
      footerText="Already have an account?"
      footerLinkLabel="Sign In"
      footerLinkHref="/sign-in"
    >
      <div className="mb-space-xl">
        <h2 className="font-display text-2xl uppercase tracking-wider font-bold text-primary mb-1">
          Create Account
        </h2>
        <p className="text-xs text-text-muted">Start your Arts Fashion journey</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-space-base">
        {error && (
          <div className="bg-badge-discount/10 border border-badge-discount/30 rounded-lg p-space-base">
            <p className="text-[11px] font-medium text-badge-discount">{error}</p>
          </div>
        )}

        <div className="space-y-1.5">
          <label className="block text-xs font-semibold text-on-surface">Full Name</label>
          <div className="relative">
            <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
            <input
              type="text"
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Your full name"
              className="w-full h-10 pl-9 pr-3 border border-border-light rounded-lg text-xs font-medium focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 transition-colors"
            />
          </div>
        </div>

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
              placeholder="Create a password"
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
          <p className="text-[10px] text-text-muted">Minimum 8 characters</p>
        </div>

        <div className="space-y-1.5">
          <label className="block text-xs font-semibold text-on-surface">Confirm Password</label>
          <div className="relative">
            <LockKeyhole className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
            <input
              type={showConfirmPassword ? "text" : "password"}
              required
              value={form.confirmPassword}
              onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })}
              placeholder="Confirm your password"
              className="w-full h-10 pl-9 pr-10 border border-border-light rounded-lg text-xs font-medium focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 transition-colors"
            />
            <button
              type="button"
              onClick={() => setShowConfirmPassword(!showConfirmPassword)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-text-muted hover:text-primary transition-colors"
            >
              {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full h-11 bg-primary hover:bg-primary-container text-white font-display uppercase tracking-wider text-xs font-bold rounded-lg transition-colors active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? "Creating Account..." : "Create Account"}
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
