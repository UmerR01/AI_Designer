import path from "node:path";
import { fileURLToPath } from "node:url";

/** Absolute path to this app (avoids wrong root when a lockfile exists in a parent folder, e.g. the user home directory). */
const projectRoot = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingRoot: projectRoot,
  // Keep dev routes warm longer so switching back to a page
  // does not constantly trigger re-compilation in webpack dev.
  onDemandEntries: {
    maxInactiveAge: 15 * 60 * 1000,
    pagesBufferLength: 10,
  },
  turbopack: {
    root: projectRoot,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  serverExternalPackages: [],
  experimental: {
    serverActions: {
      bodySizeLimit: "200mb",
    },
    proxyClientMaxBodySize: "200mb",
  },
  // Raise the API route body parser limit so large base64 image uploads don't fail.
  // Default is 4 MB; landing page images sent as data: URLs can be 2-10 MB each.
  api: {
    bodyParser: {
      sizeLimit: "50mb",
    },
  },
}

export default nextConfig
