import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Ensure logscope packages are transpiled from workspace
  transpilePackages: ['logscope', '@logscope/next'],
}

export default nextConfig
