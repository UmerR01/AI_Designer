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
}

export default nextConfig
