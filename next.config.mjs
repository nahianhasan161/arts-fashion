/** @type {import('next').NextConfig} */

/**
 * Uploaded product media is served from Tigris.
 *
 * While the bucket is private, publicUrlFor() returns same-origin /api/media
 * paths, which next/image needs no allowance for. Once TIGRIS_STORAGE_PUBLIC
 * is turned on the URLs point at the Tigris host, and the host has to be listed
 * here or next/image rejects every uploaded image on the storefront.
 *
 * The host is read from the endpoint rather than hardcoded, so a custom domain
 * or a different Tigris host needs no edit to this file. The Supabase host is
 * kept because rows written before the migration still carry Supabase URLs, and
 * those products have to keep rendering.
 */
const hostOf = (url) => {
  try {
    return new URL(url).hostname || null;
  } catch {
    return null;
  }
};

const tigrisStorageHost = hostOf(process.env.TIGRIS_STORAGE_ENDPOINT ?? "");
const supabaseStorageHost = hostOf(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");

const nextConfig = {
  images: {
    remotePatterns: [
      ...(tigrisStorageHost ? [{ protocol: "https", hostname: tigrisStorageHost }] : []),
      ...(supabaseStorageHost ? [{ protocol: "https", hostname: supabaseStorageHost }] : []),
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
