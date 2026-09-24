"use client";
import { useRouter } from "next/navigation";
import { getBrowserSupabase } from "@/lib/supabase/client";

export function SignOutButton({ label }: { label: string }) {
  const router = useRouter();
  return (
    <button
      type="button"
      className="min-h-10 rounded-lg border border-line px-3 text-sm"
      onClick={async () => {
        await getBrowserSupabase()?.auth.signOut();
        router.refresh();
      }}
    >
      {label}
    </button>
  );
}
