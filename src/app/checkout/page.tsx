"use client";

import React, { useState, useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { 
  ShieldCheck, 
  CheckCircle2, 
  ArrowLeft, 
  ShoppingBag 
} from "lucide-react";
import { useCartStore } from "@/lib/store/cart-store";
import { createOrder } from "@/lib/services/orders";

export default function CheckoutPage() {
  const [mounted, setMounted] = useState(false);

  const { items, getSubtotal, clearCart } = useCartStore();

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState<"dhaka" | "outside">("dhaka");
  const [paymentMethod, setPaymentMethod] = useState<"cod" | "bkash" | "nagad">("cod");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [orderComplete, setOrderComplete] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  const subtotal = getSubtotal();
  const freeShippingThreshold = 1500;
  const shippingFee =
    subtotal >= freeShippingThreshold || subtotal === 0
      ? 0
      : city === "dhaka"
      ? 60
      : 120;
  const grandTotal = subtotal + shippingFee;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !phone || !address) {
      alert("Please fill in your name, phone number, and delivery address.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await createOrder(
        { name, phone, email, address, city, notes },
        items,
        subtotal,
        shippingFee,
        paymentMethod
      );

      if (res.success) {
        clearCart();
        setOrderComplete(res.orderId);
      }
    } catch {
      alert("There was an error placing your order. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (orderComplete) {
    return (
      <div className="max-w-2xl mx-auto px-space-base py-20 text-center">
        <div className="w-16 h-16 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto mb-4">
          <CheckCircle2 className="w-10 h-10" />
        </div>
        <h1 className="font-display text-3xl uppercase font-bold text-primary mb-2">
          Thank you! Order Placed
        </h1>
        <p className="text-sm text-text-muted mb-4">
          Your order ID is <strong className="text-primary font-bold">{orderComplete}</strong>. We will send a confirmation SMS to <strong className="text-primary">{phone}</strong>.
        </p>

        <div className="bg-surface-card p-6 rounded-xl border border-border-light text-left text-xs mb-8 flex flex-col gap-2">
          <div className="flex justify-between border-b border-border-light pb-2 font-bold text-primary text-sm">
            <span>Payment Method</span>
            <span className="uppercase">{paymentMethod === "cod" ? "Cash On Delivery" : paymentMethod}</span>
          </div>
          <div className="flex justify-between pt-1">
            <span className="text-text-muted">Delivery Address:</span>
            <span className="text-right font-medium max-w-xs">{address}, {city === "dhaka" ? "Dhaka Metro" : "Outside Dhaka"}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-text-muted">Total Payable:</span>
            <span className="font-bold text-sm text-primary">৳ {grandTotal.toLocaleString()}</span>
          </div>
        </div>

        <Link
          href="/shop"
          className="inline-flex items-center gap-2 px-6 py-3 bg-primary text-white font-display uppercase tracking-wider text-xs font-bold rounded-lg hover:bg-primary-container transition-colors shadow-sm"
        >
          <ShoppingBag className="w-4 h-4" />
          <span>Continue Shopping</span>
        </Link>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="max-w-xl mx-auto px-space-base py-20 text-center">
        <h2 className="font-display text-2xl uppercase font-bold text-primary mb-2">
          Your Bag is Empty
        </h2>
        <p className="text-xs text-text-muted mb-6">
          Please add items to your cart before proceeding to checkout.
        </p>
        <Link
          href="/shop"
          className="px-6 py-2.5 bg-primary text-white font-display text-xs uppercase font-bold rounded-lg"
        >
          Browse Catalog
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-container-max mx-auto px-space-base py-space-xl">
      {/* Checkout Breadcrumb */}
      <div className="flex items-center justify-between pb-space-base border-b border-border-light mb-space-lg">
        <Link
          href="/shop"
          className="inline-flex items-center gap-1.5 text-xs text-text-muted hover:text-primary transition-colors font-medium"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Store</span>
        </Link>
        <div className="flex items-center gap-1 text-xs text-emerald-700 font-medium">
          <ShieldCheck className="w-4 h-4" />
          <span>256-bit Encrypted Checkout</span>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="grid grid-cols-1 lg:grid-cols-12 gap-space-xl">
        {/* Left Column: Form Details (7 cols) */}
        <div className="lg:col-span-7 flex flex-col gap-space-lg">
          {/* 1. Contact Information */}
          <div className="bg-surface-card p-space-base rounded-xl border border-border-light shadow-sm flex flex-col gap-3">
            <h2 className="font-display text-sm uppercase tracking-wider font-bold text-primary">
              1. Customer Information
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block font-semibold mb-1 text-on-surface">
                  Full Name *
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Tanvir Hasan"
                  className="w-full h-10 px-3 rounded-lg border border-border-light focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1 text-on-surface">
                  Mobile Number (11 digits) *
                </label>
                <input
                  type="tel"
                  required
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="017XXXXXXXX"
                  className="w-full h-10 px-3 rounded-lg border border-border-light focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block font-semibold mb-1 text-on-surface">
                  Email Address (Optional)
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@domain.com"
                  className="w-full h-10 px-3 rounded-lg border border-border-light focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
            </div>
          </div>

          {/* 2. Shipping Details */}
          <div className="bg-surface-card p-space-base rounded-xl border border-border-light shadow-sm flex flex-col gap-3">
            <h2 className="font-display text-sm uppercase tracking-wider font-bold text-primary">
              2. Delivery Address
            </h2>
            <div className="flex flex-col gap-3 text-xs">
              <div>
                <label className="block font-semibold mb-1 text-on-surface">
                  Destination Region *
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setCity("dhaka")}
                    className={`py-2.5 px-3 rounded-lg border text-left flex items-center justify-between transition-all ${
                      city === "dhaka"
                        ? "border-primary bg-primary/5 text-primary font-bold shadow-sm"
                        : "border-border-light bg-surface-subtle text-on-surface"
                    }`}
                  >
                    <span>Inside Dhaka Metro</span>
                    <span className="text-[10px] bg-white px-1.5 py-0.5 rounded border border-border-light">
                      ৳ 60
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setCity("outside")}
                    className={`py-2.5 px-3 rounded-lg border text-left flex items-center justify-between transition-all ${
                      city === "outside"
                        ? "border-primary bg-primary/5 text-primary font-bold shadow-sm"
                        : "border-border-light bg-surface-subtle text-on-surface"
                    }`}
                  >
                    <span>Outside Dhaka (All BD)</span>
                    <span className="text-[10px] bg-white px-1.5 py-0.5 rounded border border-border-light">
                      ৳ 120
                    </span>
                  </button>
                </div>
              </div>

              <div>
                <label className="block font-semibold mb-1 text-on-surface">
                  Detailed Street Address (House, Road, Area) *
                </label>
                <textarea
                  required
                  rows={2}
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="House 12, Road 5, Block C, Mirpur 2, Dhaka"
                  className="w-full p-3 rounded-lg border border-border-light focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              <div>
                <label className="block font-semibold mb-1 text-on-surface">
                  Order / Delivery Notes (Optional)
                </label>
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Special instructions for the delivery rider..."
                  className="w-full h-10 px-3 rounded-lg border border-border-light focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
            </div>
          </div>

          {/* 3. Payment Method */}
          <div className="bg-surface-card p-space-base rounded-xl border border-border-light shadow-sm flex flex-col gap-3">
            <h2 className="font-display text-sm uppercase tracking-wider font-bold text-primary">
              3. Payment Method
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs">
              <label
                onClick={() => setPaymentMethod("cod")}
                className={`p-3 rounded-lg border cursor-pointer flex flex-col justify-between transition-all ${
                  paymentMethod === "cod"
                    ? "border-primary bg-primary/5 shadow-sm"
                    : "border-border-light hover:bg-surface-subtle"
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="font-bold text-primary">Cash On Delivery</span>
                  <input
                    type="radio"
                    name="payment"
                    checked={paymentMethod === "cod"}
                    onChange={() => setPaymentMethod("cod")}
                    className="accent-primary"
                  />
                </div>
                <span className="text-[11px] text-text-muted">
                  Pay cash at your doorstep when you receive your package.
                </span>
              </label>

              <label
                onClick={() => setPaymentMethod("bkash")}
                className={`p-3 rounded-lg border cursor-pointer flex flex-col justify-between transition-all ${
                  paymentMethod === "bkash"
                    ? "border-[#E2136E] bg-[#E2136E]/5 shadow-sm"
                    : "border-border-light hover:bg-surface-subtle"
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="font-bold text-[#E2136E]">bKash Payment</span>
                  <input
                    type="radio"
                    name="payment"
                    checked={paymentMethod === "bkash"}
                    onChange={() => setPaymentMethod("bkash")}
                    className="accent-[#E2136E]"
                  />
                </div>
                <span className="text-[11px] text-text-muted">
                  Instant mobile wallet payment via bKash gateway.
                </span>
              </label>

              <label
                onClick={() => setPaymentMethod("nagad")}
                className={`p-3 rounded-lg border cursor-pointer flex flex-col justify-between transition-all ${
                  paymentMethod === "nagad"
                    ? "border-[#F7941D] bg-[#F7941D]/5 shadow-sm"
                    : "border-border-light hover:bg-surface-subtle"
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="font-bold text-[#F7941D]">Nagad Payment</span>
                  <input
                    type="radio"
                    name="payment"
                    checked={paymentMethod === "nagad"}
                    onChange={() => setPaymentMethod("nagad")}
                    className="accent-[#F7941D]"
                  />
                </div>
                <span className="text-[11px] text-text-muted">
                  Pay securely using your Nagad wallet balance.
                </span>
              </label>
            </div>
          </div>
        </div>

        {/* Right Column: Order Summary (5 cols) */}
        <div className="lg:col-span-5 flex flex-col gap-space-base">
          <div className="bg-surface-card p-space-base rounded-xl border border-border-light shadow-sm flex flex-col gap-4">
            <h3 className="font-display text-sm uppercase tracking-wider font-bold text-primary">
              Order Summary ({items.length} items)
            </h3>

            {/* Items scroll */}
            <div className="divide-y divide-border-light max-h-72 overflow-y-auto pr-1">
              {items.map((item) => (
                <div key={item.id} className="py-2.5 flex items-center justify-between gap-3 text-xs">
                  <div className="flex items-center gap-2.5">
                    <div className="relative w-12 h-14 rounded bg-surface-subtle overflow-hidden shrink-0 border border-border-light">
                      <Image
                        src={item.image}
                        alt={item.title}
                        fill
                        className="object-cover"
                      />
                    </div>
                    <div>
                      <h4 className="font-semibold text-on-surface line-clamp-1 max-w-[160px]">
                        {item.title}
                      </h4>
                      <span className="text-[11px] text-text-muted">
                        Size: {item.size} • Qty: {item.quantity}
                      </span>
                    </div>
                  </div>
                  <div className="font-bold text-primary shrink-0">
                    ৳ {(item.price * item.quantity).toLocaleString()}
                  </div>
                </div>
              ))}
            </div>

            {/* Calculations */}
            <div className="border-t border-border-light pt-3 flex flex-col gap-2 text-xs">
              <div className="flex justify-between text-text-muted">
                <span>Subtotal</span>
                <span className="text-on-surface font-semibold">৳ {subtotal.toLocaleString()}</span>
              </div>
              <div className="flex justify-between text-text-muted">
                <span>Delivery Charge</span>
                <span className={shippingFee === 0 ? "text-emerald-700 font-bold" : "text-on-surface font-semibold"}>
                  {shippingFee === 0 ? "FREE" : `৳ ${shippingFee}`}
                </span>
              </div>
              {subtotal < freeShippingThreshold && (
                <span className="text-[10px] text-secondary">
                  💡 Add ৳ {freeShippingThreshold - subtotal} more for Free Delivery!
                </span>
              )}
              <div className="border-t border-border-light pt-2 flex justify-between text-base font-bold text-primary">
                <span>Total Amount</span>
                <span className="font-display text-lg">৳ {grandTotal.toLocaleString()}</span>
              </div>
            </div>

            {/* Place Order CTA */}
            <button
              type="submit"
              disabled={submitting}
              className="w-full h-12 bg-primary hover:bg-primary-container text-white font-display text-xs uppercase tracking-wider font-bold rounded-lg shadow-md transition-all active:scale-[0.99] disabled:opacity-50"
            >
              {submitting ? "Placing Order..." : `CONFIRM & PLACE ORDER • ৳ ${grandTotal.toLocaleString()}`}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
