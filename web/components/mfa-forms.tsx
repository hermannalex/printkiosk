"use client";

import { useActionState } from "react";
import { confirmEmailMfa, confirmMfaSetup, regenerateRecoveryCodes, type MfaFormState } from "@/app/mfa-actions";
import { CopyButton } from "./copy-button";

function RecoveryCodes({ codes, next }: { codes: string[]; next?: { href: string; label: string } }) {
  return (
    <div className="stack">
      <div className="notice notice-ok" role="status">
        Guarde estes códigos de recuperação num lugar seguro (gerenciador de senhas ou papel). Cada um entra uma
        vez, se você perder o celular ou o acesso ao e-mail. Eles não aparecem de novo.
      </div>
      <ol className="recovery-codes mono">{codes.map((c) => <li key={c}>{c}</li>)}</ol>
      <div className="inline-actions">
        <CopyButton text={codes.join("\n")} label="Copiar códigos" />
        {next && <a className="btn btn-primary" href={next.href}>{next.label}</a>}
      </div>
    </div>
  );
}

function CodeField({ from = "app" }: { from?: "app" | "email" }) {
  return (
    <div className="field">
      <label htmlFor="codigo">{from === "email" ? "Código de 6 números do e-mail" : "Código de 6 números do aplicativo"}</label>
      <input id="codigo" name="codigo" className="mono code-input" inputMode="numeric" autoComplete="one-time-code"
        pattern={from === "email" ? "[0-9]{3}[ \\-]?[0-9]{3}" : "[0-9]{6}"} maxLength={from === "email" ? 7 : 6} required />
    </div>
  );
}

export function MfaConfirmForm({ next }: { next: { href: string; label: string } }) {
  const [state, action, pending] = useActionState<MfaFormState, FormData>(confirmMfaSetup, {});
  if (state.codes) return <RecoveryCodes codes={state.codes} next={next} />;
  return (
    <form action={action} className="stack">
      <CodeField />
      {state.error && <div className="notice notice-err" role="alert">{state.error}</div>}
      <div><button className="btn btn-primary" type="submit" disabled={pending}>Ativar</button></div>
    </form>
  );
}

export function EmailMfaConfirmForm({ next }: { next: { href: string; label: string } }) {
  const [state, action, pending] = useActionState<MfaFormState, FormData>(confirmEmailMfa, {});
  if (state.codes) return <RecoveryCodes codes={state.codes} next={next} />;
  return (
    <form action={action} className="stack">
      <CodeField from="email" />
      {state.error && <div className="notice notice-err" role="alert">{state.error}</div>}
      <div><button className="btn btn-primary" type="submit" disabled={pending}>Confirmar e ativar</button></div>
    </form>
  );
}

export function RegenerateCodesForm({ method = "app" }: { method?: "app" | "email" }) {
  const [state, action, pending] = useActionState<MfaFormState, FormData>(regenerateRecoveryCodes, {});
  if (state.codes) return <RecoveryCodes codes={state.codes} />;
  return (
    <form action={action} className="inline">
      <CodeField from={method} />
      <button className="btn" type="submit" disabled={pending}>Gerar novos códigos</button>
      {state.error && <div className="notice notice-err" role="alert">{state.error}</div>}
    </form>
  );
}
