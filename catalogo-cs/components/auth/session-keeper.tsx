"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { subscribeToLogout } from "@/lib/client-session";

export default function SessionKeeper() {
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    // El login no tiene sesion que vigilar.
    if (pathname === "/ingresar") return;

    const unsubscribe = subscribeToLogout(() => {
      router.replace("/ingresar");
      router.refresh();
    });

    return () => {
      unsubscribe();
    };
  }, [pathname, router]);

  return null;
}

