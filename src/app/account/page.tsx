"use client";

import React, { useState, useEffect } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { ArrowRight, User, Mail, Phone, MapPin, Edit, Save } from "lucide-react";
import Link from "next/link";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

const AccountPage = () => {
  const { user, signOut } = useAuth();

  const [profile, setProfile] = useState({
    full_name: user?.user_metadata?.full_name || "",
    phone: "",
    address: "",
    city: "",
  });

  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailVerified, setEmailVerified] = useState(false);
  const [checkingEmail, setCheckingEmail] = useState(true);

  useEffect(() => {
    const checkEmailVerification = async () => {
      if (!user?.email) return;
      setCheckingEmail(true);
      try {
        const supabase = getSupabaseBrowserClient();
        if (supabase) {
          const { data: { session } } = await supabase.auth.getSession();
          if (session?.user?.email_confirmed_at) {
            setEmailVerified(true);
          } else {
            setEmailVerified(false);
          }
        }
      } catch (err) {
        console.error('Error checking email verification:', err);
        setEmailVerified(false);
      } finally {
        setCheckingEmail(false);
      }
    };

    checkEmailVerification();
  }, [user?.email]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);

    try {
      const response = await fetch("/api/profile", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(profile),
      });

      if (!response.ok) {
        const data = await response.json();
        setError(data.error || "Failed to update profile");
        return;
      }

      setEditing(false);
    } catch {
      setError("An unexpected error occurred.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-container-max mx-auto px-space-base py-space-xl">
      <div className="flex flex-col lg:flex-row gap-space-xl">
        <div className="lg:w-1/3">
          <div className="bg-surface-card border border-border-light rounded-xl p-space-lg shadow-sm">
            <div className="flex flex-col items-center text-center">
              <div className="w-20 h-20 bg-primary/10 rounded-full flex items-center justify-center mb-space-base">
                <User className="w-10 h-10 text-primary" />
              </div>

              <h1 className="font-display text-xl uppercase tracking-wider font-bold text-primary mb-1">
                {user?.email || "Guest"}
              </h1>
              <p className="text-xs text-text-muted mb-space-lg">Account Member</p>

              {emailVerified && user?.email && !checkingEmail && (
                <div className="w-full bg-green-50 border border-green-200 rounded-lg p-2 mb-space-lg">
                  <p className="text-green-700 text-xs font-medium flex items-center gap-1">
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd"/>
                    </svg>
                    Email Verified
                  </p>
                </div>
              )}

              {checkingEmail && user?.email && (
                <div className="w-full bg-yellow-50 border border-yellow-200 rounded-lg p-2 mb-space-lg">
                  <p className="text-yellow-700 text-xs font-medium">Checking verification status...</p>
                </div>
              )}

              {!user?.email && (
                <div className="w-full bg-blue-50 border border-blue-200 rounded-lg p-2 mb-space-lg">
                  <p className="text-blue-700 text-xs font-medium mb-2">Email not yet verified</p>
                  <Link
                    href="/sign-in"
                    className="inline-flex items-center gap-1 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-semibold hover:bg-blue-700 transition-colors"
                  >
                    Verify Email
                    <ArrowRight className="w-3.5 h-3.5" />
                  </Link>
                </div>
              )}

              <button
                onClick={signOut}
                className="w-full h-10 border border-border-light rounded-lg text-xs font-semibold uppercase tracking-wider text-text-muted hover:bg-surface-subtle hover:text-primary transition-colors"
              >
                Sign Out
              </button>
            </div>
          </div>
        </div>

        <div className="lg:w-2/3 flex flex-col gap-space-lg">
          <div className="bg-surface-card border border-border-light rounded-xl p-space-lg shadow-sm">
            <div className="flex items-center justify-between mb-space-lg pb-space-base border-b border-border-light">
              <h2 className="font-display text-lg uppercase tracking-wider font-bold text-primary">
                Profile Information
              </h2>

              {!editing ? (
                <button
                  onClick={() => setEditing(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-border-light rounded-lg text-xs font-semibold text-text-muted hover:bg-surface-subtle hover:text-primary transition-colors"
                >
                  <Edit className="w-3.5 h-3.5" />
                  Edit
                </button>
              ) : (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setEditing(false)}
                    className="px-3 py-1.5 border border-border-light rounded-lg text-xs font-semibold text-text-muted hover:bg-surface-subtle transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary text-white rounded-lg text-xs font-semibold uppercase tracking-wider hover:bg-primary-container transition-colors disabled:opacity-50"
                  >
                    <Save className="w-3.5 h-3.5" />
                    {saving ? "Saving..." : "Save"}
                  </button>
                </div>
              )}
            </div>

            {error && (
              <div className="bg-badge-discount/10 border border-badge-discount/30 rounded-lg p-space-base mb-space-lg">
                <p className="text-[11px] font-medium text-badge-discount">{error}</p>
              </div>
            )}

            <div className="space-y-space-base">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-space-base">
                <div>
                  <label className="block text-xs font-semibold text-on-surface mb-1.5">Full Name</label>
                  {editing ? (
                    <div className="relative">
                      <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
                      <input
                        type="text"
                        value={profile.full_name}
                        onChange={(e) => setProfile({ ...profile, full_name: e.target.value })}
                        className="w-full h-10 pl-9 pr-3 border border-border-light rounded-lg text-xs font-medium focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 transition-colors"
                      />
                    </div>
                  ) : (
                    <p className="text-sm text-on-surface py-2.5 px-3 bg-surface-subtle rounded-lg">
                      {profile.full_name || "Not set"}
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-semibold text-on-surface mb-1.5">Email</label>
                  <p className="text-sm text-on-surface py-2.5 px-3 bg-surface-subtle rounded-lg flex items-center gap-2">
                    <Mail className="w-4 h-4 text-text-muted" />
                    {user?.email}
                  </p>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-on-surface mb-1.5">Phone</label>
                {editing ? (
                  <div className="relative">
                    <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
                    <input
                      type="tel"
                      value={profile.phone}
                      onChange={(e) => setProfile({ ...profile, phone: e.target.value })}
                      placeholder="+880 1xxx xxxxxx"
                      className="w-full h-10 pl-9 pr-3 border border-border-light rounded-lg text-xs font-medium focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 transition-colors"
                    />
                  </div>
                ) : (
                  <p className="text-sm text-on-surface py-2.5 px-3 bg-surface-subtle rounded-lg">
                    {profile.phone || "Not set"}
                  </p>
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold text-on-surface mb-1.5">Address</label>
                {editing ? (
                  <div className="relative">
                    <MapPin className="absolute left-3 top-3 w-4 h-4 text-text-muted" />
                    <textarea
                      value={profile.address}
                      onChange={(e) => setProfile({ ...profile, address: e.target.value })}
                      rows={2}
                      placeholder="House, Road, Area, Dhaka"
                      className="w-full px-3 py-2.5 border border-border-light rounded-lg text-xs font-medium focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 transition-colors resize-none"
                    />
                  </div>
                ) : (
                  <p className="text-sm text-on-surface py-2.5 px-3 bg-surface-subtle rounded-lg">
                    {profile.address || "Not set"}
                  </p>
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold text-on-surface mb-1.5">City</label>
                {editing ? (
                  <div className="relative">
                    <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
                    <input
                      type="text"
                      value={profile.city}
                      onChange={(e) => setProfile({ ...profile, city: e.target.value })}
                      placeholder="Dhaka, Chattogram, etc."
                      className="w-full h-10 pl-9 pr-3 border border-border-light rounded-lg text-xs font-medium focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 transition-colors"
                    />
                  </div>
                ) : (
                  <p className="text-sm text-on-surface py-2.5 px-3 bg-surface-subtle rounded-lg">
                    {profile.city || "Not set"}
                  </p>
                )}
              </div>
            </div>
          </div>

          <div className="bg-surface-card border border-border-light rounded-xl p-space-lg shadow-sm">
            <h2 className="font-display text-lg uppercase tracking-wider font-bold text-primary mb-space-lg">
              Account Preferences
            </h2>

            <div className="space-y-space-base">
              <div className="flex items-center justify-between py-3 border-b border-border-light last:border-b-0">
                <div>
                  <p className="text-sm font-semibold text-on-surface">Email Notifications</p>
                  <p className="text-[11px] text-text-muted">Receive order updates via email</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input type="checkbox" className="sr-only peer" />
                  <div className="w-11 h-6 bg-surface-subtle peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary" />
                </label>
              </div>

              <div className="flex items-center justify-between py-3 border-b border-border-light last:border-b-0">
                <div>
                  <p className="text-sm font-semibold text-on-surface">SMS Notifications</p>
                  <p className="text-[11px] text-text-muted">Receive delivery updates via SMS</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input type="checkbox" className="sr-only peer" />
                  <div className="w-11 h-6 bg-surface-subtle peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary" />
                </label>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AccountPage;