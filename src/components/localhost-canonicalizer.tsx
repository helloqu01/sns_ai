"use client";

import { useEffect } from "react";

const LOCALHOST_ALIASES = new Set(["localhost", "0.0.0.0", "::1", "[::1]"]);

export function LocalhostCanonicalizer() {
  useEffect(() => {
    const url = new URL(window.location.href);
    if (!LOCALHOST_ALIASES.has(url.hostname)) {
      return;
    }

    // Canva dev OAuth redirect is registered against 127.0.0.1:3002.
    // Keep the app on the same loopback host so popup cookies and callback URL align.
    url.hostname = "127.0.0.1";
    window.location.replace(url.toString());
  }, []);

  return null;
}
