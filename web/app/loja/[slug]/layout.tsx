import Link from "next/link";
import { customerLogout } from "../actions";
import { BrandMark, Wordmark } from "@/components/ui";
import { openStore } from "@/lib/store";
import { currentCustomer } from "@/lib/store-auth";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const store = await openStore(slug);
  return { title: store ? `${store.name} · Imprimir online` : "Loja indisponível · imprime.ai" };
}

export default async function StoreLayout({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const store = await openStore(slug);
  if (!store) {
    return (
      <main className="auth">
        <div className="card auth-card">
          <h1 className="brand-title"><BrandMark size={36} /> <Wordmark /></h1>
          <p>Esta loja não está recebendo pedidos online no momento.</p>
          <p className="small muted">Confira o endereço ou fale com a loja.</p>
        </div>
      </main>
    );
  }
  const customer = await currentCustomer(store.id);
  const base = `/loja/${store.slug}`;
  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <Link href={base} className="brand store-brand">
            <span className="store-initial" aria-hidden="true">{store.name.slice(0, 1).toUpperCase()}</span>
            <span>{store.name} <small>Impressão online</small></span>
          </Link>
          <nav className="nav" aria-label="Loja">
            <Link href={`${base}/pedido/novo`}>Novo pedido</Link>
            {customer && <Link href={`${base}/pedidos`}>Meus pedidos</Link>}
          </nav>
          <div className="user">
            {customer ? (
              <>
                <span>{customer.name.split(/\s+/)[0]}</span>
                <form action={customerLogout}>
                  <input type="hidden" name="loja" value={store.slug} />
                  <button type="submit" className="btn btn-sm">Sair</button>
                </form>
              </>
            ) : (
              <Link href={`${base}/entrar`} className="btn btn-sm">Entrar</Link>
            )}
          </div>
        </div>
      </header>
      <main className="page store-page">{children}</main>
      <footer className="store-foot">
        Pagamento por Pix direto para {store.name} · feito com <a href="https://imprime.ai" target="_blank" rel="noopener">imprime.ai</a>
      </footer>
    </>
  );
}
