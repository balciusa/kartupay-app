import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  experimental: {
    // Avoid bundling supabase-js into the server chunk to dodge invalid source map parsing in Turbopack
    serverExternalPackages: ['@supabase/supabase-js'],
  },
}

export default nextConfig
