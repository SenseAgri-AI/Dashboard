import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep ffmpeg-static's prebuilt binary out of the bundler and ensure it's traced into the
  // serverless function for the egg-clip transcode route (mp4v → H.264 for inline playback).
  serverExternalPackages: ["ffmpeg-static"],
  outputFileTracingIncludes: {
    "/api/egg-count/clip-stream": ["./node_modules/ffmpeg-static/**"],
  },
};

export default nextConfig;
