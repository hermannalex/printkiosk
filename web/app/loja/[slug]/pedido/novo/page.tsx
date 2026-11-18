import { notFound, redirect } from "next/navigation";
import OrderBuilder from "./order-builder";
import { openStore } from "@/lib/store";
import { currentCustomer } from "@/lib/store-auth";
import { enabledExtras, enabledSizes } from "@/lib/store-price";

export default async function NewOrder({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const store = await openStore(slug);
  if (!store) notFound();
  const customer = await currentCustomer(store.id);
  if (!customer) redirect(`/loja/${store.slug}/entrar?next=${encodeURIComponent(`/loja/${store.slug}/pedido/novo`)}`);
  const config = { sizes: enabledSizes(store.config), extras: enabledExtras(store.config) };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Novo pedido</h1>
          <p>Envie fotos ou PDF e escolha como imprimir cada um. O valor aparece na hora.</p>
        </div>
      </div>
      {config.sizes.length === 0 ? (
        <p className="card empty">A loja ainda não publicou os preços. Tente mais tarde.</p>
      ) : (
        <OrderBuilder slug={store.slug} storeId={store.id} customerId={customer!.id} config={config} />
      )}
    </>
  );
}
