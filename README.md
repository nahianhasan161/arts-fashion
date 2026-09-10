# Arts Fashion E-Commerce Store

A high-conversion e-commerce web platform built with **Next.js 14 (App Router)**, **TypeScript**, **Tailwind CSS**, **Zustand**, and **Supabase**.

---

## 🚀 Features

- **Storefront Home (`/`)**:
  - Corporate B2B banner ticker with custom wholesale quoting.
  - "Minimalist Aura" signature hero banner with direct collection CTAs.
  - "Explore Fast" horizontal icon strip for quick filtering.
  - 6-Column "New Arrivals" responsive product showcase.
  - World Cup 2026 Sports jersey dual banner modules.
  - Designer Polo Series bento layout with large editorial spotlight.
- **Catalog & Shop (`/shop`)**:
  - Breadcrumb trail and curated item count indicators.
  - Sub-category quick navigation chips (Half Sleeve T-Shirts, Polos, Panjabi, Trousers, etc.).
  - Responsive Filter Sidebar:
    - Active filter pills with single-click removal and "Clear All".
    - Category tree with item counts.
    - Interactive BDT price range slider (৳ 150 – ৳ 5,500).
    - Size selector matrix (`XS` to `3XL`) with inventory numbers.
    - In-stock only toggle switch.
  - Sorting: Newest, Best Selling / Popular, Price Low-to-High, Price High-to-Low.
- **Product Detail Page (`/products/[slug]`)**:
  - Multi-angle thumbnail strip with high-resolution imagery.
  - Discount & inventory status badges (`24% OFF`, `IN STOCK`).
  - Star ratings, 128 verified customer reviews, and live order count ticker.
  - BDT price engine with computed savings (`৳ 649` vs `৳ 850`).
  - Color swatch selector with active outlines.
  - Size matrix with chest measurements and low-stock urgency alerts.
  - Quantity incrementor + "ADD TO CART" & "BUY NOW (EXPRESS CHECKOUT)" actions.
  - Domestic dispatch ETA info (Dhaka Metro 24-48h, Outside Dhaka 3-5 days).
  - Interactive Size Guide modal.
- **Zustand State Management**:
  - `useCartStore`: Persistent slide-over cart drawer with real-time subtotal, quantity adjustment, and Free Delivery progress bar (threshold ৳ 1,500).
  - `useWishlistStore`: Persistent wishlist toggling with header counter badge.
  - `useFilterStore`: Multi-parameter catalog filtering.
- **Checkout & Order Flow (`/checkout`)**:
  - Shipping address form with dynamic regional delivery fees (Dhaka Metro: ৳ 60, Outside Dhaka: ৳ 120, Free over ৳ 1,500).
  - Payment options: Cash on Delivery (COD), bKash, and Nagad.
  - Instant order placement with Supabase insertion and fallback receipt generation.
- **Supabase Backend**:
  - Complete SQL migration script (`supabase/schema.sql`) for `categories`, `products`, `orders`, `order_items`, and `profiles` with Row Level Security (RLS) policies.
  - Service layer (`lib/services/products.ts`, `lib/services/orders.ts`) with automatic fallback to rich mock data when Supabase is not yet connected.

---

## 🛠️ Tech Stack

- **Framework**: Next.js 14 (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS (with exact tokens from Stitch design system)
- **Typography**: Oswald (Display) & Plus Jakarta Sans (Body & Currency)
- **State Management**: Zustand
- **Database & Auth**: Supabase (`@supabase/supabase-js`, `@supabase/ssr`)
- **Icons**: Lucide React

---

## 📦 Getting Started

### 1. Installation

```bash
cd /Users/al-nahianhasan/Documents/Projects/Nextjs/arts-fashion
npm install
```

### 2. Configure Supabase (Optional)

Create a `.env.local` file from `.env.example`:

```bash
cp .env.example .env.local
```

Fill in your project credentials:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
```

Execute the database schema in your Supabase SQL Editor using [`supabase/schema.sql`](supabase/schema.sql).

*(Note: If you do not configure Supabase right away, the store will automatically run using its built-in catalog data!)*

### 3. Run Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.
