import type { Metadata } from "next";
import "./globals.css";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { CartDrawer } from "@/components/cart/CartDrawer";
import { WishlistDrawer } from "@/components/wishlist/WishlistDrawer";
import { AuthProvider } from "@/components/auth/AuthProvider";
import { ClientProviders } from "@/components/ClientProviders";

const fontSans = "font-sans";

export const metadata: Metadata = {
  title: "Arts Fashion | Premium Everyday Apparel",
  description:
    "Arts Fashion • Combed Compact Organic Cotton • Regular Fit • Modern Commercial Fashion. Handcrafted for daylong comfort.",
  icons: {
    icon: "/fab.ico",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={fontSans}>
      <body className="bg-surface font-body text-on-surface antialiased min-h-screen flex flex-col">
        <AuthProvider>
          <ClientProviders>
            <Header />
            <CartDrawer />
            <WishlistDrawer />
            <main className="flex-1 pt-[120px] lg:pt-[164px]">
              {children}
            </main>
            <Footer />
          </ClientProviders>
        </AuthProvider>
      </body>
    </html>
  );
}
