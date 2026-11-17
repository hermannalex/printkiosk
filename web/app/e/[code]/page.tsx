import type { Metadata } from "next";
import { openRelaySession, RELAY_MAX_FILES } from "@/lib/relay";
import RelayUploader from "./relay-uploader";
import styles from "./relay.module.css";

export const metadata: Metadata = {
  title: "Enviar para impressão · imprime.ai",
  robots: { index: false, follow: false },
};

/** The page the customer's phone opens from the kiosk's QR Code (works on Wi-Fi or 4G/5G). */
export default async function SendPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const session = await openRelaySession(code);

  if (!session) {
    return (
      <main className={styles.main}>
        <div className={styles.badge}>imprime.ai</div>
        <h1 className={styles.h1}>Este link expirou</h1>
        <p className={styles.sub}>Toque em <b>Do celular</b> na tela do quiosque e leia o QR Code de novo.</p>
      </main>
    );
  }

  const kiosk = session.kioskName || "o quiosque";
  return (
    <main className={styles.main}>
      <div className={styles.badge}>imprime.ai</div>
      <h1 className={styles.h1}>Enviar para {kiosk}</h1>
      <p className={styles.sub}>
        Escolha fotos ou arquivos PDF. Eles aparecem na tela do quiosque em poucos segundos. Funciona no Wi-Fi ou no 4G/5G.
      </p>
      <RelayUploader code={code} maxFiles={RELAY_MAX_FILES} />
      <p className={styles.note}>
        Os arquivos passam pelo servidor do imprime.ai só para chegar ao quiosque: ficam guardados no máximo 30 minutos e são
        apagados assim que o quiosque os recebe. Limite de 50 MB por arquivo.
      </p>
    </main>
  );
}
