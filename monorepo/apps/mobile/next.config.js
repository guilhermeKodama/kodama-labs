/** @type {import('next').NextConfig} */
const nextConfig = {
  // Enable static export for offline-first mobile app
  output: 'export',
  
  // Disable image optimization for static export
  images: {
    unoptimized: true,
  },
  
  // Disable trailing slash for cleaner URLs
  trailingSlash: false,
  
  // Disable server-side features that require SSR
  experimental: {
    // Disable any experimental features that might require server
  },
  
  // Note: headers() not compatible with static export
  // Cache control will be handled by service worker in PWA
};

module.exports = nextConfig;
