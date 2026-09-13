import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  // Avoid bundling supabase-js into the server chunk.
  serverExternalPackages: ['@supabase/supabase-js'],
}

export default nextConfig
