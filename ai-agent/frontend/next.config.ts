import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: [
    'localhost:3000',
    '127.0.0.1:3000',
    '3000-01kv59zkwtt53q9vyv55jr5rwv.cloudspaces.litng.ai',
    '3000-01kvz9dgax2v4da6mbbfkh5e72.cloudspaces.litng.ai',
  ],
};

export default nextConfig;