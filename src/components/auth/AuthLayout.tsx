import { ArrowRight, LockKeyhole, Mail, UserPlus } from "lucide-react";
import Link from "next/link";

type AuthLayoutProps = {
  title: string;
  description: string;
  children: React.ReactNode;
  footerText: string;
  footerLinkLabel: string;
  footerLinkHref: string;
};

export function AuthLayout({
  title,
  description,
  children,
  footerText,
  footerLinkLabel,
  footerLinkHref,
}: AuthLayoutProps) {
  return (
    <div className="min-h-[calc(100vh-120px)] lg:min-h-[calc(100vh-164px)] flex items-center justify-center px-space-base py-space-2xl">
      <div className="w-full max-w-5xl grid grid-cols-1 lg:grid-cols-2 gap-space-2xl items-center">
        <div className="hidden lg:flex flex-col justify-center">
          <div className="inline-flex items-center gap-2 text-accent-gold mb-space-lg">
            <span className="w-10 h-px bg-accent-gold"></span>
            <span className="font-display uppercase text-xs tracking-[0.25em] font-bold">
              Arts Fashion Account
            </span>
            <span className="w-10 h-px bg-accent-gold"></span>
          </div>
          <h1 className="font-display text-4xl xl:text-5xl uppercase text-primary leading-[1.05] font-bold">
            {title}
          </h1>
          <p className="text-text-muted mt-space-lg max-w-md text-sm leading-7">
            {description}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-space-base mt-space-2xl">
            {[
              {
                icon: LockKeyhole,
                label: "Secure access",
                value: "Protected by Supabase Auth",
              },
              {
                icon: Mail,
                label: "Fast checkout",
                value: "Save your account details",
              },
              {
                icon: UserPlus,
                label: "One click return",
                value: "Shop again in seconds",
              },
            ].map((feature) => {
              const Icon = feature.icon;
              return (
                <div
                  key={feature.label}
                  className="bg-surface-card border border-border-light rounded-xl p-space-base shadow-sm"
                >
                  <Icon className="w-5 h-5 text-accent-gold mb-2" />
                  <p className="font-display uppercase text-xs text-primary font-bold">
                    {feature.label}
                  </p>
                  <p className="text-[11px] text-text-muted mt-1 leading-5">
                    {feature.value}
                  </p>
                </div>
              );
            })}
          </div>
        </div>

        <div className="bg-surface-card border border-border-light rounded-2xl shadow-lg p-space-base sm:p-space-xl">
          {children}
          <p className="text-center text-xs text-text-muted mt-space-base">
            {footerText}{" "}
            <Link
              href={footerLinkHref}
              className="text-primary font-bold hover:text-secondary transition-colors"
            >
              {footerLinkLabel}
            </Link>
            <ArrowRight className="w-3.5 h-3.5 inline-block ml-1 text-primary" />
          </p>
        </div>
      </div>
    </div>
  );
}
