/** @type {import('next').NextConfig} */

// Uploaded product media is served from the project's Supabase Storage
// bucket, so its host has to be allowed here or next/image will reject
// every uploaded image on the storefront.
const supabaseStorageHost = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").hostname || null;
  } catch {
    return null;
  }
})();

const nextConfig = {
  images: {
    remotePatterns: [
      ...(supabaseStorageHost
        ? [{ protocol: "https", hostname: supabaseStorageHost }]
        : []),
      {
        protocol: "https",
        hostname: "lh3.googleusercontent.com",
      },
      {
        protocol: "https",
        hostname: "contribution.usercontent.google.com",
      },
      {
        protocol: "https",
        hostname: "fabrilife.com",
      },
      {
        protocol: "https",
        hostname: "images.unsplash.com",
      },
    ],
  },
};

export default nextConfig;

