import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: [
    // Sve uobičajene lokalne podmreže
    '*.local',
    '192.168.*.*',
    '10.*.*.*',
    '172.16.*.*',
    'localhost',
    '127.0.0.1',
    '::1',           // IPv6 localhost
  ],

  async rewrites() {
    return [
      {
        source: "/api/flights",
        destination:
          "https://montenegroairports.com/aerodromixs/cache-flights.php?airport=tv",
      },
    ];
  },

  async headers() {
    return [
      {
        source: '/api/:path*',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Access-Control-Allow-Methods', value: 'GET,OPTIONS' },
        ],
      },
    ];
  },
};

export default nextConfig;