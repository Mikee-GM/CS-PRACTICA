import type { NextConfig } from "next";
import path from "node:path";

/*
 * Cabeceras de seguridad de las paginas. El backend ya manda las suyas con
 * helmet, pero las paginas las sirve Next y salian sin ninguna: se podian
 * incrustar en un iframe ajeno (clickjacking) y el navegador adivinaba tipos.
 *
 * No hay Content-Security-Policy a proposito: Next inyecta scripts en linea y
 * el mapa carga teselas de otros hosts, asi que una politica estricta pide
 * nonces y una prueba aparte para no romper el panel.
 */
const cabecerasDeSeguridad = [
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains",
  },
  // La ubicacion la piden los portales; camara y microfono no se usan.
  {
    key: "Permissions-Policy",
    value: "geolocation=(self), camera=(self), microphone=()",
  },
];

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: cabecerasDeSeguridad }];
  },
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
