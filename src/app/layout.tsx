import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "YouTabMaker",
  description: "Turn YouTube guitar practice videos into reusable tab references."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
