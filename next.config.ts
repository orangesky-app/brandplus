import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [{ source: "/dashboard/admin", destination: "/admin", permanent: false }];
  },
  // Only the Shopify admin may frame Skylitee (embedded app); blocks clickjacking elsewhere.
  // App pages loaded with a session token get a store-specific policy from middleware.
  async headers() {
    return [{
      source: "/:path*",
      headers: [{
        key: "Content-Security-Policy",
        value: "frame-ancestors https://*.myshopify.com https://admin.shopify.com;",
      }],
    }];
  },
};

export default nextConfig;
