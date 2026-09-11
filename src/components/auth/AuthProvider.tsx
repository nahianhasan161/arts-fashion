"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";
import type { UserRole } from "@/types";

type AuthContextValue = {
  user: User | null;
  role: UserRole | null;
  isAdmin: boolean;
  loading: boolean;
  configured: boolean;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<UserRole | null>(null);
  const [loading, setLoading] = useState(true);
  const configured = isSupabaseConfigured;

  const fetchRole = useCallback(async (userId: string) => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", userId)
        .single();

      if (!error && data) {
        setRole(data.role as UserRole);
      } else {
        setRole("user");
      }
    } catch {
      setRole("user");
    }
  }, []);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();

    if (!supabase) {
      setLoading(false);
      return;
    }

    let active = true;

    supabase.auth.getSession().then(({ data }) => {
      if (active) {
        const sessionUser = data.session?.user ?? null;
        setUser(sessionUser);
        if (sessionUser) {
          fetchRole(sessionUser.id);
        }
      }
    }).finally(() => {
      if (active) {
        setLoading(false);
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      const newUser = session?.user ?? null;
      setUser(newUser);
      if (newUser) {
        fetchRole(newUser.id);
      } else {
        setRole(null);
      }
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [fetchRole]);

  const signOut = useCallback(async () => {
    const supabase = getSupabaseBrowserClient();

    if (supabase) {
      await supabase.auth.signOut();
    }

    setUser(null);
    setRole(null);
    router.refresh();
    router.push("/");
  }, [router]);

  const isAdmin = role === "admin";

  const value = useMemo(
    () => ({ user, role, isAdmin, loading, configured, signOut }),
    [user, role, isAdmin, loading, configured, signOut]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }

  return context;
}
