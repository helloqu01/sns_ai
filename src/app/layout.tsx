import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/components/auth-provider";
import { AppShell } from "@/components/app-shell";
import { LocalhostCanonicalizer } from "@/components/localhost-canonicalizer";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Insta AI Studio | AI Marketing Tool",
  description: "Create stunning festival card news with AI in minutes.",
};

const DEV_BROWSER_RECOVERY_SCRIPT = `
(function () {
  if (typeof window === "undefined") return;
  var host = window.location.hostname;
  var isLoopback = host === "127.0.0.1" || host === "localhost" || host === "0.0.0.0" || host === "::1" || host === "[::1]";
  if (!isLoopback) return;
  var runKey = "__sns_ai_dev_recovery_v2__";
  if (window.sessionStorage.getItem(runKey)) return;
  window.sessionStorage.setItem(runKey, "1");

  var cleanupTasks = [];
  if ("serviceWorker" in navigator && navigator.serviceWorker) {
    cleanupTasks.push(
      navigator.serviceWorker.getRegistrations()
        .then(function (regs) {
          return Promise.all(regs.map(function (reg) { return reg.unregister(); }))
            .then(function () { return regs.length; });
        })
        .catch(function () { return 0; })
    );
  }

  if ("caches" in window && window.caches) {
    cleanupTasks.push(
      caches.keys()
        .then(function (keys) {
          return Promise.all(keys.map(function (key) { return caches.delete(key); }))
            .then(function () { return keys.length; });
        })
        .catch(function () { return 0; })
    );
  }

  Promise.all(cleanupTasks).then(function (counts) {
    var touched = counts.some(function (count) { return count > 0; });
    if (touched) {
      window.location.reload();
    }
  });
})();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        {process.env.NODE_ENV === "development" && (
          <script
            dangerouslySetInnerHTML={{ __html: DEV_BROWSER_RECOVERY_SCRIPT }}
          />
        )}
        <LocalhostCanonicalizer />
        <AuthProvider>
          <AppShell>{children}</AppShell>
        </AuthProvider>
      </body>
    </html>
  );
}
