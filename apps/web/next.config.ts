import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Allow Next to compile our workspace package source instead of expecting prebuilt JS.
  transpilePackages: ['@sudoku-squad/core'],
  reactStrictMode: true,
  typedRoutes: true,
};

export default nextConfig;
