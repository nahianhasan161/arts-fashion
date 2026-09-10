import React from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight, ChevronRight } from "lucide-react";
import { getProducts } from "@/lib/services/products";
import { ProductCard } from "@/components/product/ProductCard";

export default async function HomePage() {
  const products = await getProducts();
  const newArrivals = products.slice(0, 6);
  const poloSeries = products.filter((p) => p.sub_category === "Polo T-Shirts" || p.id === "prod-2" || p.id === "prod-10");
  const displayPolos = poloSeries.length >= 3 ? poloSeries.slice(0, 3) : products.slice(1, 4);

  return (
    <div className="flex flex-col w-full pb-space-3xl">
      {/* 1. Announcement & Corporate Ticker Bar */}
      <div className="w-full bg-accent-gold-soft py-2.5 px-space-base border-b border-accent-gold/20">
        <div className="max-w-container-max mx-auto flex flex-col md:flex-row items-center justify-between gap-2 text-center md:text-left">
          <div className="flex items-center gap-2.5 flex-wrap justify-center md:justify-start">
            <span className="px-2 py-0.5 bg-primary text-white font-display text-[10px] uppercase tracking-wider rounded font-bold">
              B2B & Custom
            </span>
            <span className="font-display uppercase text-xs sm:text-sm text-primary font-bold tracking-wide">
              Event T-shirt / Corporate Wholesale
            </span>
            <span className="hidden md:inline text-on-surface-variant text-xs font-body">
              — Clothing crafted with your brand logo or bespoke design worldwide.
            </span>
          </div>
          <Link
            href="/shop"
            className="inline-flex items-center gap-1 font-display text-xs text-secondary hover:text-primary font-bold uppercase tracking-wider transition-colors"
          >
            <span>Get Custom Quote</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>

      {/* 2. Hero Banner: Minimalist Aura */}
      <section className="relative w-full overflow-hidden bg-surface-subtle">
        <div className="max-w-container-max mx-auto px-space-base py-space-sm sm:py-space-md">
          <div className="relative w-full rounded-xl sm:rounded-2xl overflow-hidden shadow-lg aspect-[16/9] sm:aspect-[21/9] min-h-[360px]">
            <Image
              src="https://lh3.googleusercontent.com/aida/AEtjO1UqKNLQ3Qwq2Fh9xLwSmv8chkYhyU3lZbgF6Yrm2Qqe5kKTWzeG_3S-j5s0ag-gU_3eAhrIuiKmuZcSLVuYRhxP1qtkZkkGj810wJRnqzU_sKUfFD0lQO2r2jB8N1aNcoMOpUYJORKMN2SiphR5KmMz5kurIeGXvrcwAqyz2jtx7BwU0qMXatfThLGVJDHFDkPoJ8kd3EMy7li7c4jhORpHR2Avi1fjXYJJ9inhJWg0RiY2jnJB6Kf6PaM"
              alt="Arts Fashion Minimalist Aura Hero Collection"
              fill
              priority
              className="object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-r from-[#091523]/85 via-[#091523]/40 to-transparent flex flex-col justify-end md:justify-center p-space-base sm:p-space-xl md:p-space-2xl text-white">
              <div className="max-w-md flex flex-col gap-2">
                <span className="font-display text-xs uppercase tracking-widest text-secondary-container font-semibold">
                  Monsoon Signature Series
                </span>
                <h1 className="font-display text-3xl sm:text-5xl uppercase leading-none drop-shadow font-bold">
                  Minimalist Aura
                </h1>
                <p className="text-xs sm:text-sm text-surface-subtle/90 line-clamp-2 max-w-sm mt-1">
                  Pure combed compact cotton engineered for uncompromised all-day breathability and clean architectural form.
                </p>
                <div className="flex flex-wrap items-center gap-2 pt-2">
                  <Link
                    href="/shop?category=men"
                    className="px-5 py-2.5 bg-accent-gold text-white font-display text-xs uppercase font-bold rounded hover:bg-secondary transition-colors shadow-sm"
                  >
                    Shop Men
                  </Link>
                  <Link
                    href="/shop?category=women"
                    className="px-5 py-2.5 bg-white text-primary font-display text-xs uppercase font-bold rounded hover:bg-surface-subtle transition-colors shadow-sm"
                  >
                    Shop Women
                  </Link>
                  <Link
                    href="/shop?category=kids"
                    className="px-5 py-2.5 bg-white text-primary font-display text-xs uppercase font-bold rounded hover:bg-surface-subtle transition-colors shadow-sm"
                  >
                    Shop Kids
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 3. Quick Horizontal Navigation Strips / Micro Tags */}
      <section className="w-full bg-surface-card py-space-sm border-y border-border-light">
        <div className="max-w-container-max mx-auto px-space-base">
          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar py-1">
            <span className="font-display text-xs uppercase text-text-muted whitespace-nowrap pl-1 font-semibold">
              Explore Fast:
            </span>
            {[
              { label: "Half Sleeve T-Shirt", href: "/shop?category=men" },
              { label: "Designer Polo", href: "/shop?category=men" },
              { label: "Drop Shoulder", href: "/shop?category=men" },
              { label: "Kurti & Tops", href: "/shop?category=women" },
              { label: "Official Football Jersey", href: "/shop?category=sports" },
              { label: "Comfy Trousers", href: "/shop?category=men" },
              { label: "Kids Club", href: "/shop?category=kids" },
            ].map((tag) => (
              <Link
                key={tag.label}
                href={tag.href}
                className="px-3.5 py-1.5 bg-surface-subtle hover:bg-primary hover:text-white text-on-surface-variant rounded-lg font-display text-xs font-semibold uppercase tracking-wider transition-all whitespace-nowrap border border-border-light hover:border-primary shrink-0"
              >
                {tag.label}
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* 4. Editorial Section: New Arrivals (6 Column Grid) */}
      <section className="max-w-container-max mx-auto px-space-base pt-space-2xl pb-space-xl w-full">
        <div className="flex flex-col items-center text-center mb-space-xl">
          <div className="inline-flex items-center gap-2 text-accent-gold mb-1">
            <span className="w-6 h-0.5 bg-accent-gold"></span>
            <span className="font-display text-xs uppercase tracking-widest font-bold">
              Fresh From The Loom
            </span>
            <span className="w-6 h-0.5 bg-accent-gold"></span>
          </div>
          <h2 className="font-display text-2xl sm:text-3xl uppercase text-primary tracking-wide font-bold">
            NEW ARRIVALS
          </h2>
          <p className="text-xs sm:text-sm text-text-muted mt-1 max-w-lg">
            Engineered with high fabric standards, breathable organic fibers, and urban contemporary cuts.
          </p>
        </div>

        {/* 6 Column Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-space-sm sm:gap-space-md">
          {newArrivals.map((product) => (
            <ProductCard key={product.id} product={product} aspectRatio="square" />
          ))}
        </div>
      </section>

      {/* 5. Dual Sports Jersey Banner Modules */}
      <section className="max-w-container-max mx-auto px-space-base py-space-base w-full">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-space-base">
          {/* Player Edition */}
          <div className="relative rounded-xl overflow-hidden shadow-md group aspect-[16/9] min-h-[220px]">
            <Image
              src="https://lh3.googleusercontent.com/aida/AEtjO1XtRs88VSBzdbMWQYRQuAY8CMk93-FpKuVlyb4a4idBDt95ROa-QuuKBaeOYjyhts6byy9S6RakXa0MkP45VJRbQ2P5ixraZTP7wBi2v4OfPwjYGUGEM0LLf24iv1Tpqz9ttMJnPF8M7Ka-yBomlyibQgY5rAYEVXaEn_pW9_nDIrkpdg5QXdDvVKNk968t2nuHE0zqs7YctPeS0kASeelv_7Pw3pI9gAFWPOAfM88aUoQ_7RVNdLPX6cs"
              alt="Official Jersey Edition 2026 World Cup"
              fill
              className="object-cover group-hover:scale-105 transition-transform duration-700"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-primary/90 via-primary/30 to-transparent flex flex-col justify-end p-space-lg text-white">
              <span className="font-display text-xs uppercase tracking-widest text-secondary-container font-semibold">
                Performance AeroReady
              </span>
              <h3 className="font-display text-xl sm:text-2xl uppercase font-bold">
                Official Jersey Edition 2026
              </h3>
              <div className="pt-2">
                <Link
                  href="/shop?category=sports"
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-white text-primary font-display text-xs uppercase font-bold rounded hover:bg-accent-gold hover:text-white transition-all shadow-sm"
                >
                  <span>Shop Player Jerseys</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              </div>
            </div>
          </div>

          {/* Fan Edition */}
          <div className="relative rounded-xl overflow-hidden shadow-md group aspect-[16/9] min-h-[220px]">
            <Image
              src="https://lh3.googleusercontent.com/aida/AEtjO1VSsuS-bMnkbmp9bj8GtBG2rt0isVRi1a-by8pysBnM5HNFZjMo4ozYS7E_gLcgFxiFYfwa601txmJPPIoCfhrLLz2DtSoYVvkhyK6hEaJ-Ne2kTYVo40BsYl8w-iKkt1sPsegKte0I2kEr8RikXRwx8ojKXH2U3-fBc_yBNezTfvS3ySSK3ljgN00TlR83r_tcFHLjVyMpfcGySymjJo0Sl7VWayQyqH6xXEweJ6-n7XV9BwB19YlF3Hg"
              alt="Fan Made Jersey 2026 World Cup"
              fill
              className="object-cover group-hover:scale-105 transition-transform duration-700"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-primary/90 via-primary/30 to-transparent flex flex-col justify-end p-space-lg text-white">
              <span className="font-display text-xs uppercase tracking-widest text-secondary-container font-semibold">
                Supporter Matchday Kit
              </span>
              <h3 className="font-display text-xl sm:text-2xl uppercase font-bold">
                Fan Edition World Cup 2026
              </h3>
              <div className="pt-2">
                <Link
                  href="/shop?category=sports"
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-white text-primary font-display text-xs uppercase font-bold rounded hover:bg-accent-gold hover:text-white transition-all shadow-sm"
                >
                  <span>Explore Fan Editions</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 6. Editorial Bento: Designer Polo Series */}
      <section className="max-w-container-max mx-auto px-space-base pt-space-2xl pb-space-lg w-full">
        <div className="flex items-center justify-between mb-space-base pb-space-xs border-b border-border-light">
          <div className="flex items-center gap-2">
            <span className="w-2 h-6 bg-accent-gold rounded-full"></span>
            <h2 className="font-display text-xl sm:text-2xl uppercase text-primary tracking-wide font-bold">
              Designer Polo Series
            </h2>
          </div>
          <Link
            href="/shop?category=men"
            className="font-display text-xs uppercase tracking-wider text-text-muted hover:text-primary flex items-center gap-1 font-semibold transition-colors"
          >
            <span>View All Polos</span>
            <ChevronRight className="w-4 h-4" />
          </Link>
        </div>

        {/* Bento Layout: 4 cols Spotlight + 8 cols 3 Cards */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-space-base">
          {/* Big Spotlight */}
          <div className="lg:col-span-4 relative rounded-xl overflow-hidden shadow-sm bg-surface-container group min-h-[380px]">
            <Image
              src="https://lh3.googleusercontent.com/aida/AEtjO1U1ogfkFu2dSqV9wDuYtYw9iTOtlDVRHNnmwURZ1d180ZepiZfuLZdxPdt6zDSYrSWiBxnxolsbs7D5L6PWd1nuh1Qfkg-frXBQJ0BcaN7I7kwR0TVizLd9Gk8GfWg-ml5ymPRMHnvVgvP8qKXt6jpfwLjoXhzGoHEydArKlcdX8lJ7oT1_VKb_N-87UKrg0VlDta4DffLWg5PbH_V3AYwUcI3plJ2tYWe5Ql1vvRbYJzkAIaTJKMZLkF0"
              alt="Synchronizer Designer Polo"
              fill
              className="object-cover group-hover:scale-105 transition-transform duration-700"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-primary/95 via-primary/40 to-transparent flex flex-col justify-end p-space-lg text-white">
              <span className="font-display text-xs uppercase tracking-widest text-accent-gold font-semibold">
                Double PK Knitted
              </span>
              <h3 className="font-display text-2xl uppercase leading-tight font-bold">
                The Aurum & Synchronizer
              </h3>
              <p className="text-xs text-surface-subtle/80 mt-1 line-clamp-2">
                Contrasting collar tips, custom jacquard ribs, and breathable 220 GSM combed yarn.
              </p>
              <div className="mt-3">
                <Link
                  href="/shop?category=men"
                  className="px-5 py-2 bg-accent-gold text-white font-display text-xs uppercase font-bold rounded inline-block hover:bg-secondary transition-colors"
                >
                  Shop Collection
                </Link>
              </div>
            </div>
          </div>

          {/* 3 Product Cards */}
          <div className="lg:col-span-8 grid grid-cols-1 sm:grid-cols-3 gap-space-base">
            {displayPolos.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
