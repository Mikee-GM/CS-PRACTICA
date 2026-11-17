import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname, ".."),
  experimental: {
    serverActions: {
      bodySizeLimit: "20mb",
    },
    /*
     * El middleware copia el cuerpo de toda peticion que case con su `matcher`
     * y, por defecto, lo corta en 10 MB sin error: la Server Action recibe un
     * multipart truncado. Las paginas del portal estan en el matcher y suben
     * videos de hasta 20 MB (publicaciones del feed), asi que se iguala al
     * limite de las Server Actions.
     */
    middlewareClientMaxBodySize: "20mb",
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.r2.dev",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "*.r2.cloudflarestorage.com",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "images.unsplash.com",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "*.cloudflare.com",
        pathname: "/**",
      },
    ],
    formats: ["image/avif", "image/webp"],
    deviceSizes: [640, 750, 828, 1080, 1200],
    imageSizes: [128, 256, 384],
    minimumCacheTTL: 31536000,
  },
};

export default nextConfig;
