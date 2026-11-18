import Link from "next/link";
import { notFound } from "next/navigation";
import { openStore } from "@/lib/store";
import { currentCustomer } from "@/lib/store-auth";
import { UNIT_LABEL, enabledExtras, enabledSizes, priceLabel } from "@/lib/store-price";

export default async function StoreHome({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const store = await openStore(slug);
  if (!store) notFound();
  const customer = await currentCustomer(store.id);
  const sizes = enabledSizes(store.config);
  const extras = enabledExtras(store.config);
  const base = `/loja/${store.slug}`;

  return (
    <>
      <section className="store-hero">
        <h1>Envie seus arquivos e retire impresso na {store.name}</h1>
        <p>Fotos e PDF pelo celular ou computador. Você vê o valor antes, paga por Pix e recebe um aviso quando ficar pronto.</p>
        <div className="inline-actions">
          <Link className="btn btn-primary" href={`${base}/pedido/novo`}>Fazer pedido</Link>
          {!customer && <Link className="btn" href={`${base}/cadastro`}>Criar cadastro</Link>}
        </div>
      </section>

      <ol className="store-steps">
        <li><b>Envie</b> fotos ou PDF, até 50 MB cada.</li>
        <li><b>Escolha</b> formato, cores e cópias de cada arquivo.</li>
        <li><b>Pague por Pix</b> e acompanhe o pedido.</li>
        <li><b>Retire</b> quando avisarmos que está pronto.</li>
      </ol>

      <section className="grid-2">
        <div className="card">
          <div className="card-head"><h2>Preços por página</h2></div>
          {sizes.length === 0 ? <p className="empty">A loja ainda não publicou os preços.</p> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Formato</th><th className="num">Preto e branco</th><th className="num">Colorido</th></tr></thead>
                <tbody>
                  {sizes.map((s) => (
                    <tr key={s.id}><td>{s.name}</td><td className="num">{priceLabel(s.pb)}</td><td className="num">{priceLabel(s.color)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <div className="card stack">
          <div className="card-head"><h2>Adicionais e retirada</h2></div>
          {extras.length > 0 && (
            <ul className="plain-list">
              {extras.map((e) => (
                <li key={e.id}><span>{e.name}</span><span className="num">{e.cents === 0 ? "sem custo" : `${priceLabel(e.cents)} ${UNIT_LABEL[e.unit]}`}</span></li>
              ))}
            </ul>
          )}
          <p className="pre-line">{store.pickupInfo || "Retire no balcão da loja com o código do pedido."}</p>
        </div>
      </section>
    </>
  );
}
