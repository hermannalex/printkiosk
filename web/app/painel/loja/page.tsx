import Link from "next/link";
import { createStore, removeStoreToken, saveStoreBasics, saveStorePrices, saveStoreToken } from "../../store-actions";
import { requireUser } from "@/lib/auth";
import { sql } from "@/lib/db";
import { brl } from "@/lib/format";
import { ownerHasEnterprise } from "@/lib/kiosks";
import { PLANS } from "@/lib/plans";
import { PUBLIC_URL, storeOfOwner } from "@/lib/store";
import { UNIT_LABEL } from "@/lib/store-price";
import { CopyButton } from "@/components/copy-button";
import { Flash, Shell, param, type SearchParams } from "@/components/ui";

export const metadata = { title: "Loja online · imprime.ai" };
export const dynamic = "force-dynamic";

const money = (cents: number | null) => (cents === null ? "" : (cents / 100).toFixed(2).replace(".", ","));

export default async function StoreSettings({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser();
  const params = await searchParams;
  const [store, enterprise] = await Promise.all([storeOfOwner(user.id), ownerHasEnterprise(user.id)]);
  const flash = <Flash msg={param(params, "msg")} erro={param(params, "erro")} />;

  if (!store) {
    return (
      <Shell user={user} area="owner" current="/painel/loja">
        <div className="page-head">
          <div>
            <h1>Loja online</h1>
            <p>Seus clientes enviam arquivos pelo site, escolhem formato e cores, pagam por Pix e retiram impresso.</p>
          </div>
        </div>
        {flash}
        <section className="grid-2">
          <div className="card stack">
            <h2>Como funciona</h2>
            <ol className="steps">
              <li>Você define os formatos de papel, os preços em preto e branco e colorido, e adicionais como encadernação.</li>
              <li>O cliente cria um cadastro com nome, e-mail e senha no endereço da sua loja e envia fotos ou PDF.</li>
              <li>O valor é calculado na hora e o cliente paga por Pix. O dinheiro cai direto na sua conta do Mercado Pago, sem taxa do imprime.ai.</li>
              <li>Você recebe um e-mail, abre o pedido aqui, vê os arquivos e baixa para imprimir. Ao marcar como pronto, o cliente é avisado.</li>
            </ol>
          </div>
          <div className="card stack">
            <h2>Plano Enterprise</h2>
            <p className="plan-price">{brl(PLANS.enterprise.cents)}<span className="small muted"> /mês</span></p>
            <p className="muted">Tudo do Pro, mais a loja online. {enterprise ? "Seu plano Enterprise está ativo." : "Assine em Quiosques e assinatura para publicar a loja."}</p>
            <div className="inline-actions">
              <form action={createStore}><button className="btn btn-primary" type="submit">Começar a configurar</button></form>
              {!enterprise && <Link className="btn" href="/painel/quiosques">Assinar Enterprise</Link>}
            </div>
          </div>
        </section>
      </Shell>
    );
  }

  const address = `${PUBLIC_URL}/loja/${store.slug}`;
  const counts = await sql`
    select count(*) filter (where status = 'paid')::int as paid, count(*) filter (where status = 'printing')::int as printing,
           count(*) filter (where status = 'ready')::int as ready
    from store_orders where store_id = ${store.id}`;
  const sizes = [...store.config.sizes, { id: "", name: "", enabled: true, pb: null, color: null }, { id: "", name: "", enabled: true, pb: null, color: null }];
  const extras = [...store.config.extras, { id: "", name: "", enabled: true, cents: 0, unit: "page" as const }, { id: "", name: "", enabled: true, cents: 0, unit: "page" as const }];
  const live = store.published && store.hasToken && enterprise;

  return (
    <Shell user={user} area="owner" current="/painel/loja">
      <div className="page-head">
        <div>
          <h1>Loja online</h1>
          <p>{live ? "Sua loja está no ar recebendo pedidos." : "Sua loja ainda não está no ar."}</p>
        </div>
        <Link className="btn btn-primary" href="/painel/loja/pedidos">
          Pedidos{counts[0]?.paid ? ` · ${counts[0].paid} novo${counts[0].paid > 1 ? "s" : ""}` : ""}
        </Link>
      </div>
      {flash}
      {!enterprise && (
        <p className="notice notice-err">
          A loja só fica no ar com o plano Enterprise ({brl(PLANS.enterprise.cents)}/mês) ativo em um dos seus quiosques.{" "}
          <Link href="/painel/quiosques">Assinar</Link>
        </p>
      )}

      <section className="card stack">
        <div className="card-head"><h2>Endereço da loja</h2><span className={`pill ${live ? "pill-active" : "pill-never"}`}>{live ? "No ar" : "Fora do ar"}</span></div>
        <div className="code-box">{address}</div>
        <div className="inline-actions">
          <CopyButton text={address} label="Copiar link" />
          {live && <a className="btn btn-sm" href={address} target="_blank" rel="noopener">Abrir loja</a>}
        </div>
        <p className="small muted">Divulgue no Instagram, no WhatsApp e num cartaz no balcão.</p>
      </section>

      <section className="grid-2">
        <form action={saveStoreBasics} className="card stack">
          <div className="card-head"><h2>Dados da loja</h2></div>
          <div className="field">
            <label htmlFor="nome">Nome que o cliente vê</label>
            <input id="nome" name="nome" defaultValue={store.name} required maxLength={60} />
          </div>
          <div className="field">
            <label htmlFor="endereco">Endereço (depois de /loja/)</label>
            <input id="endereco" name="endereco" defaultValue={store.slug} required maxLength={40} pattern="[a-z0-9][a-z0-9\-]{1,38}[a-z0-9]" />
          </div>
          <div className="field">
            <label htmlFor="retirada">Retirada: endereço e horário</label>
            <textarea id="retirada" name="retirada" defaultValue={store.pickupInfo} maxLength={500} rows={3}
                      placeholder="Rua das Flores, 120 · seg a sex 8h às 18h, sáb 8h às 12h" />
          </div>
          <div className="field">
            <label htmlFor="aviso">E-mail que recebe os pedidos pagos</label>
            <input id="aviso" name="aviso" type="email" defaultValue={store.notifyEmail ?? ""} placeholder={user.email} maxLength={254} />
          </div>
          <label className="check"><input type="checkbox" name="publicada" defaultChecked={store.published} /> Loja publicada (recebendo pedidos)</label>
          <div><button className="btn btn-primary" type="submit">Salvar</button></div>
        </form>

        <div className="card stack">
          <div className="card-head"><h2>Recebimento por Pix</h2><span className={`pill ${store.hasToken ? "pill-active" : "pill-never"}`}>{store.hasToken ? "Configurado" : "Pendente"}</span></div>
          <p className="small muted">
            Os pedidos são pagos por Pix direto na sua conta do Mercado Pago, sem taxa do imprime.ai (o Mercado Pago cobra a tarifa dele de Pix).
            Cole aqui o <b>Access Token de produção</b>. Ele é guardado criptografado e não aparece de novo.{" "}
            <a href="https://imprime.ai/mercado-pago.html" target="_blank" rel="noopener">Como gerar o token</a>
          </p>
          {store.hasToken && <p>Token cadastrado, terminado em <b className="mono">…{store.tokenTail}</b>.</p>}
          <form action={saveStoreToken} className="stack">
            <div className="field">
              <label htmlFor="token">{store.hasToken ? "Trocar o token" : "Access Token"}</label>
              <input id="token" name="token" type="password" autoComplete="off" spellCheck={false} placeholder="APP_USR-…" required maxLength={300} />
            </div>
            <div><button className="btn btn-primary" type="submit">Conferir e salvar</button></div>
          </form>
          {store.hasToken && (
            <form action={removeStoreToken}>
              <button className="btn btn-sm btn-danger" type="submit">Remover token</button>
            </form>
          )}
        </div>
      </section>

      <form action={saveStorePrices} className="card stack">
        <div className="card-head">
          <h2>Formatos e preços por página</h2>
          <button className="btn btn-primary" type="submit">Salvar preços</button>
        </div>
        <p className="small muted">Deixe o preço vazio para não oferecer aquela cor. Para criar um formato, preencha uma linha em branco. Para apagar, limpe o nome.</p>
        <div className="table-wrap">
          <table className="edit-table">
            <thead><tr><th>Ativo</th><th>Formato</th><th>Preto e branco (R$)</th><th>Colorido (R$)</th></tr></thead>
            <tbody>
              {sizes.map((s, i) => (
                <tr key={i}>
                  <td>
                    <input type="hidden" name={`size_id_${i}`} value={s.id} />
                    <input type="checkbox" name={`size_on_${i}`} defaultChecked={s.enabled} aria-label={`Ativar ${s.name || "novo formato"}`} />
                  </td>
                  <td><input name={`size_name_${i}`} defaultValue={s.name} maxLength={40} placeholder={s.id ? "" : "Novo formato"} /></td>
                  <td><input name={`size_pb_${i}`} defaultValue={money(s.pb)} inputMode="decimal" maxLength={10} placeholder="—" /></td>
                  <td><input name={`size_color_${i}`} defaultValue={money(s.color)} inputMode="decimal" maxLength={10} placeholder="—" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h3 style={{ marginTop: 24 }}>Adicionais</h3>
        <p className="small muted">Opções que o cliente marca por arquivo. O valor é somado {UNIT_LABEL.page} impressa, {UNIT_LABEL.copy} ou uma vez {UNIT_LABEL.file}. Use 0,00 para opções sem custo.</p>
        <div className="table-wrap">
          <table className="edit-table">
            <thead><tr><th>Ativo</th><th>Adicional</th><th>Valor (R$)</th><th>Cobrança</th></tr></thead>
            <tbody>
              {extras.map((e, i) => (
                <tr key={i}>
                  <td>
                    <input type="hidden" name={`extra_id_${i}`} value={e.id} />
                    <input type="checkbox" name={`extra_on_${i}`} defaultChecked={e.enabled} aria-label={`Ativar ${e.name || "novo adicional"}`} />
                  </td>
                  <td><input name={`extra_name_${i}`} defaultValue={e.name} maxLength={40} placeholder={e.id ? "" : "Novo adicional"} /></td>
                  <td><input name={`extra_cents_${i}`} defaultValue={e.id ? money(e.cents) : ""} inputMode="decimal" maxLength={10} placeholder="0,00" /></td>
                  <td>
                    <select name={`extra_unit_${i}`} defaultValue={e.unit}>
                      <option value="page">Por página</option>
                      <option value="copy">Por cópia</option>
                      <option value="file">Por arquivo</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div><button className="btn btn-primary" type="submit">Salvar preços</button></div>
      </form>
    </Shell>
  );
}
