import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Admin Panel",
  robots: { index: false, follow: false },
};

// Stands alone, outside the customer dashboard and its login.
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <main className="min-h-screen bg-[#F5F5F4] dark:bg-[#0C0C0C] p-3 md:p-5">{children}</main>;
}
