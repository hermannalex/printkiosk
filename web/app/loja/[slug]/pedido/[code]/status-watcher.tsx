"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/** Asks the server every 4 seconds whether the Pix was paid; reloads the page when it changes. */
export default function StatusWatcher({ code }: { code: string }) {
  const router = useRouter();
  const [checks, setChecks] = useState(0);
  useEffect(() => {
    let stopped = false;
    const timer = setInterval(async () => {
      if (stopped || document.hidden) return;
      try {
        const response = await fetch(`/api/loja/pedido/${code}/status`, { cache: "no-store" });
        const body = await response.json();
        setChecks((n) => n + 1);
        if (body.status && body.status !== "awaiting_payment") {
          stopped = true;
          clearInterval(timer);
          router.refresh();
        }
      } catch {
        // offline for a moment: try on the next tick
      }
    }, 4000);
    return () => { stopped = true; clearInterval(timer); };
  }, [code, router]);
  return <p className="small muted" aria-live="polite">{checks === 0 ? "Esperando o pagamento…" : "Esperando o pagamento… esta página atualiza sozinha."}</p>;
}
