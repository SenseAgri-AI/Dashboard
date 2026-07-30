import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// Public routes that do NOT require authentication.
// Everything else (dashboard, logs, analytics, and their APIs) is protected.
const isPublicRoute = createRouteMatcher([
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/api/webhooks(.*)",
]);

// Next.js 16 middleware convention: this file is `src/proxy.ts` and the handler
// is exported as `proxy` (a default export is also accepted).
export const proxy = clerkMiddleware(async (auth, req) => {
  if (!isPublicRoute(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    // Run on everything except Next internals and static assets…
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpg|jpeg|gif|png|svg|ico|webp|avif|woff2?|ttf|map)).*)",
    // …and always run on API routes.
    "/(api|trpc)(.*)",
    // Clerk's handshake/proxy path.
    "/__clerk/:path*",
  ],
};
