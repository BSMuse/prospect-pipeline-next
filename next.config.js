/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['pg', 'winston', 'cheerio'],
  },
};

module.exports = nextConfig;
