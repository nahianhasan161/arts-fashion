import React from "react";
import Image from "next/image";
import Link from "next/link";
import { 
  ShieldCheck, 
  Truck, 
  RotateCcw, 
  Headphones 
} from "lucide-react";

export function Footer() {
  return (
    <footer className="w-full bg-[#111923] text-[#a0aec0] pt-space-2xl border-t border-border-light/10">
      {/* 1. Value Proposition Strip */}
      <div className="max-w-container-max mx-auto px-space-base pb-space-2xl border-b border-[#2d3748]">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-space-lg">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-white/5 flex items-center justify-center text-accent-gold shrink-0">
              <Truck className="w-5 h-5" />
            </div>
            <div>
              <h4 className="text-white font-display uppercase tracking-wider text-sm font-semibold">
                Fast Nationwide Delivery
              </h4>
              <p className="text-xs text-[#718096] mt-1">
                Dhaka metro in 24-48 hrs, all 64 districts within 3-5 days.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-white/5 flex items-center justify-center text-accent-gold shrink-0">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h4 className="text-white font-display uppercase tracking-wider text-sm font-semibold">
                100% Organic Fabric
              </h4>
              <p className="text-xs text-[#718096] mt-1">
                Certified combed compact cotton with zero harsh chemicals.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-white/5 flex items-center justify-center text-accent-gold shrink-0">
              <RotateCcw className="w-5 h-5" />
            </div>
            <div>
              <h4 className="text-white font-display uppercase tracking-wider text-sm font-semibold">
                7 Days Easy Return
              </h4>
              <p className="text-xs text-[#718096] mt-1">
                Hassle-free doorstep size exchange & return policy.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-white/5 flex items-center justify-center text-accent-gold shrink-0">
              <Headphones className="w-5 h-5" />
            </div>
            <div>
              <h4 className="text-white font-display uppercase tracking-wider text-sm font-semibold">
                Dedicated Support
              </h4>
              <p className="text-xs text-[#718096] mt-1">
                Call +8809677666888 or chat with us every day 9 AM - 10 PM.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* 2. Main Footer Links */}
      <div className="max-w-container-max mx-auto px-space-base py-space-2xl">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-space-xl">
          {/* Brand Info */}
          <div className="lg:col-span-2 flex flex-col gap-space-sm">
            <Link href="/" className="inline-flex items-center">
              <div className="bg-white px-3 py-1.5 rounded-md inline-flex items-center shadow-sm">
                <Image
                  src="/logo.jpg"
                  alt="arts fashion"
                  width={160}
                  height={30}
                  className="h-6 w-auto object-contain"
                />
              </div>
            </Link>
            <p className="text-xs leading-relaxed max-w-sm text-[#718096]">
              Arts Fashion is engineered with high fabric standards, bespoke craftsmanship, and contemporary everyday apparel. Designed with passion, loved worldwide.
            </p>
            <div className="flex items-center gap-3 pt-2">
              <a
                href="#"
                className="w-8 h-8 rounded-full bg-white/5 hover:bg-accent-gold hover:text-primary transition-all flex items-center justify-center text-white"
                aria-label="Facebook"
              >
                <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24">
                  <path d="M22 12c0-5.52-4.48-10-10-10S2 6.48 2 12c0 4.84 3.44 8.87 8 9.8V15H8v-3h2V9.5C10 7.57 11.57 6 13.5 6H16v3h-2c-.55 0-1 .45-1 1v2h3v3h-3v6.95c5.05-.5 9-4.76 9-9.95z"/>
                </svg>
              </a>
              <a
                href="#"
                className="w-8 h-8 rounded-full bg-white/5 hover:bg-accent-gold hover:text-primary transition-all flex items-center justify-center text-white"
                aria-label="Instagram"
              >
                <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24">
                  <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/>
                </svg>
              </a>
              <a
                href="#"
                className="w-8 h-8 rounded-full bg-white/5 hover:bg-accent-gold hover:text-primary transition-all flex items-center justify-center text-white"
                aria-label="YouTube"
              >
                <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24">
                  <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
                </svg>
              </a>
            </div>
          </div>

          {/* Quick Links */}
          <div className="flex flex-col gap-2">
            <h5 className="font-display uppercase tracking-wider text-white text-xs font-bold mb-2">
              Shop Collections
            </h5>
            <Link href="/shop?category=men" className="text-xs hover:text-white transition-colors">
              Men&apos;s Half Sleeve T-Shirts
            </Link>
            <Link href="/shop?category=men" className="text-xs hover:text-white transition-colors">
              Designer Double PK Polos
            </Link>
            <Link href="/shop?category=women" className="text-xs hover:text-white transition-colors">
              Women&apos;s Kurti & Tops
            </Link>
            <Link href="/shop?category=men" className="text-xs hover:text-white transition-colors">
              Comfy & Active Trousers
            </Link>
            <Link href="/shop?category=sports" className="text-xs hover:text-white transition-colors">
              World Cup Sports Editions
            </Link>
          </div>

          {/* Customer Care */}
          <div className="flex flex-col gap-2">
            <h5 className="font-display uppercase tracking-wider text-white text-xs font-bold mb-2">
              Customer Care
            </h5>
            <Link href="/shop" className="text-xs hover:text-white transition-colors">
              Size Measurement Guide
            </Link>
            <Link href="#" className="text-xs hover:text-white transition-colors">
              Track Your Order
            </Link>
            <Link href="#" className="text-xs hover:text-white transition-colors">
              Return & Exchange Policy
            </Link>
            <Link href="#" className="text-xs hover:text-white transition-colors">
              Store Locations
            </Link>
            <Link href="#" className="text-xs hover:text-white transition-colors">
              Corporate & Bulk Orders
            </Link>
          </div>

          {/* Payment & Security */}
          <div className="flex flex-col gap-3">
            <h5 className="font-display uppercase tracking-wider text-white text-xs font-bold">
              We Accept
            </h5>
            <div className="flex flex-wrap gap-2">
              <span className="px-2.5 py-1 bg-white/5 border border-white/10 rounded text-[11px] font-bold text-white">
                Cash on Delivery
              </span>
              <span className="px-2.5 py-1 bg-[#E2136E]/20 text-[#E2136E] border border-[#E2136E]/30 rounded text-[11px] font-bold">
                bKash
              </span>
              <span className="px-2.5 py-1 bg-[#F7941D]/20 text-[#F7941D] border border-[#F7941D]/30 rounded text-[11px] font-bold">
                Nagad
              </span>
              <span className="px-2.5 py-1 bg-white/5 border border-white/10 rounded text-[11px] font-bold text-white">
                Visa / MasterCard
              </span>
            </div>
            <p className="text-[11px] text-[#718096] mt-2">
              All transactions are secured with 256-bit SSL encryption.
            </p>
          </div>
        </div>
      </div>

      {/* 3. Copyright Strip */}
      <div className="bg-[#0b1017] py-4 border-t border-white/5">
        <div className="max-w-container-max mx-auto px-space-base flex flex-col sm:flex-row items-center justify-between text-[11px] text-[#4a5568] gap-2">
          <span>
            © {new Date().getFullYear()} Arts Fashion Ltd. All rights reserved.
          </span>
          <div className="flex items-center gap-4">
            <Link href="#" className="hover:text-white transition-colors">
              Privacy Policy
            </Link>
            <span>•</span>
            <Link href="#" className="hover:text-white transition-colors">
              Terms of Service
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
