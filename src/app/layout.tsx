import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { getCurrentStaff } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { countUnreadNotifications } from "@/lib/notifications/queries";
import { SiteHeader } from "@/components/SiteHeader";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "DOUSEN WORK",
  description: "制作工程を流す業務OS",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const staff = await getCurrentStaff();

  let unreadCount = 0;
  if (staff) {
    const supabase = await createSupabaseServerClient();
    unreadCount = await countUnreadNotifications(supabase, staff.id);
  }

  return (
    <html
      lang="ja"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {staff ? <SiteHeader role={staff.role} unreadCount={unreadCount} /> : null}
        {children}
      </body>
    </html>
  );
}
