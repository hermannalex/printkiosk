import { saveKioskConfig } from "@/app/actions";
import { brl } from "@/lib/format";
import { IDLE_OPTIONS, PAYMENT_OPTIONS, effectiveConfig, sanitizeConfig } from "@/lib/kiosk-config";

type Kiosk = Record<string, any>;

const money = (cents: number) => (cents / 100).toFixed(2).replace(".", ",");
const duration = (s: number) => (s < 60 ? `${s} segundos` : s % 60 ? `${s} segundos` : `${s / 60} minuto${s === 60 ? "" : "s"}`);
const priceLabel = (cents: number) => (cents === 0 ? "grátis" : `${brl(cents)} por página`);

/** Every setting of the kiosk app that makes sense remotely; applied by the kiosk on its next sync. */
export function KioskConfigForm({ kiosk, from }: { kiosk: Kiosk; from: "painel" | "master" }) {
  const c = effectiveConfig(Number(kiosk.config_version) > 0 ? kiosk.config : null, kiosk.reported_config);
  const reported = kiosk.reported_config ? sanitizeConfig(kiosk.reported_config) : null;
  const pending = Number(kiosk.config_version) > 0 && Number(kiosk.applied_config_version ?? 0) < Number(kiosk.config_version);
  const fid = (name: string) => `cfg-${name}`;

  return (
    <section className="card stack">
      <div className="card-head"><h2>Configurações do app</h2></div>
      <p className="small muted">
        {reported
          ? <>No quiosque agora: <b>{priceLabel(reported.pricePerPageCents ?? 0)}</b>, até {reported.maxCopies} cópias e {reported.maxItems} itens.</>
          : "O quiosque ainda não informou as configurações atuais (precisa da versão nova do app)."}
        {pending && <> <b>Alterações salvas aguardando o quiosque conectar.</b></>}
      </p>
      <form action={saveKioskConfig} className="config-form">
        <input type="hidden" name="id" value={String(kiosk.id)} />
        <input type="hidden" name="de" value={from} />

        <fieldset>
          <legend>Impressão e preço</legend>
          <div className="field">
            <label htmlFor={fid("preco")}>Preço por página (R$)</label>
            <input id={fid("preco")} name="preco" inputMode="decimal" placeholder="0,50" maxLength={9} required
                   defaultValue={money(c.pricePerPageCents)} className="mono" autoComplete="off" />
            <span className="small muted">0,00 = impressão gratuita, sem Pix. Vale por página e por cópia.</span>
          </div>
          <div className="field">
            <label htmlFor={fid("copias")}>Máximo de cópias</label>
            <input id={fid("copias")} name="copias" type="number" min={1} max={50} required defaultValue={c.maxCopies} />
          </div>
          <div className="field">
            <label htmlFor={fid("itens")}>Máximo de itens por impressão</label>
            <input id={fid("itens")} name="itens" type="number" min={1} max={50} required defaultValue={c.maxItems} />
          </div>
        </fieldset>

        <fieldset>
          <legend>Pagamento Pix</legend>
          <div className="field">
            <label htmlFor={fid("email")}>E-mail do pagador (o da loja)</label>
            <input id={fid("email")} name="email_pagador" type="email" maxLength={254} defaultValue={c.payerEmail} placeholder="loja@exemplo.com" />
          </div>
          <div className="field">
            <label htmlFor={fid("pix")}>Tempo para pagar</label>
            <select id={fid("pix")} name="tempo_pix" defaultValue={String(c.paymentTimeoutSeconds)}>
              {PAYMENT_OPTIONS.map((s) => <option key={s} value={s}>{duration(s)}</option>)}
            </select>
          </div>
        </fieldset>

        <fieldset>
          <legend>Tela e Wi-Fi</legend>
          <div className="field">
            <label htmlFor={fid("nome")}>Nome na tela do quiosque</label>
            <input id={fid("nome")} name="nome_tela" maxLength={40} required defaultValue={c.kioskName} />
          </div>
          <div className="field">
            <label htmlFor={fid("idle")}>Voltar ao início após inatividade</label>
            <select id={fid("idle")} name="inatividade" defaultValue={String(c.idleTimeoutSeconds)}>
              {IDLE_OPTIONS.map((s) => <option key={s} value={s}>{s === 90 ? "90 segundos" : duration(s)}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor={fid("wifi")}>Wi-Fi dos clientes (nome)</label>
            <input id={fid("wifi")} name="wifi" maxLength={32} defaultValue={c.wifiName} autoComplete="off" />
          </div>
          <div className="field">
            <label htmlFor={fid("wifi-senha")}>Senha do Wi-Fi dos clientes</label>
            <input id={fid("wifi-senha")} name="wifi_senha" maxLength={63} defaultValue={c.wifiPassword} autoComplete="off" />
            <span className="small muted">Aparece em QR Code na tela do quiosque. Deixe o nome em branco para não mostrar.</span>
          </div>
        </fieldset>

        <div><button className="btn btn-primary" type="submit">Salvar configurações</button></div>
      </form>
      <p className="small muted">
        Ficam só no aparelho: a impressora (encontrada na rede da loja), o PIN do atendente e o token do Mercado Pago.
      </p>
    </section>
  );
}
