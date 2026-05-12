"use client";

import { usePathname, useRouter } from "next/navigation";

export function BackButton() {
  const pathname = usePathname();
  const router = useRouter();

  if (pathname === "/") return null;

  return (
    <button
      type="button"
      onClick={() => router.back()}
      className="fixed top-5 left-5 z-50 label-pill cursor-pointer shadow-md flex items-center gap-1.5 stagger-in"
      style={{ background: "var(--panel)", backdropFilter: "blur(10px)" }}
    >
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M19 12H5M12 5l-7 7 7 7"/>
      </svg>
      Back
    </button>
  );
}
