import { googleEnabled } from "@/lib/google";

/** Plain link (GET): the server sets the state cookie and sends the browser to Google. */
export function GoogleButton({ from, label }: { from: "entrar" | "cadastro"; label: string }) {
  if (!googleEnabled()) return null;
  return (
    <>
      <a className="btn btn-google" href={`/api/auth/google?de=${from}`}>{label}</a>
      <div className="or"><span>ou</span></div>
    </>
  );
}
