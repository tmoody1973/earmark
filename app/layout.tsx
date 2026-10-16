import type { Metadata } from "next";
import { Figtree, Literata } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";

// Literata: a text serif drawn for long-form screen reading (optical sizes 7–72), so titles and the "why" share one
// voice from 15px card text to the wordmark. Figtree: a plain, open workhorse sans for labels and metadata.
const literata = Literata({ subsets: ["latin"], axes: ["opsz"], variable: "--font-literata", display: "swap" });
const figtree = Figtree({ subsets: ["latin"], variable: "--font-figtree", display: "swap" });

export const metadata: Metadata = {
  title: "Earmark",
  description: "The ideas you keep saying and the tips people give you.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${literata.variable} ${figtree.variable}`}>
      <body>
        <ClerkProvider>{children}</ClerkProvider>
      </body>
    </html>
  );
}
