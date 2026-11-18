"use client";

import { upload } from "@vercel/blob/client";
import { useRef, useState } from "react";
import { MAX_COPIES, MAX_ORDER_FILES, UNIT_LABEL, priceItem, priceLabel, type StoreConfig } from "@/lib/store-price";

const MAX_BYTES = 50 * 1024 * 1024;
const EXTENSIONS = ["pdf", "jpg", "jpeg", "png", "heic", "heif", "webp", "gif", "bmp"];

type Checked = { pathname: string; name: string; kind: "pdf" | "image"; size: number; pages: number; token: string };

type Item = {
  id: number;
  name: string;
  state: "sending" | "checking" | "ready" | "error";
  progress: number;
  message: string;
  file?: Checked;
  paper: string;
  color: boolean;
  copies: number;
  extras: string[];
};

function safeFileName(name: string): string {
  const cleaned = name.normalize("NFC").replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(-100);
  return cleaned || "arquivo";
}

function randomFolder(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Date.now().toString(36) + Array.from(bytes, (b) => (b % 36).toString(36)).join("");
}

function contentTypeOf(file: File): string {
  if (file.type) return file.type;
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "pdf") return "application/pdf";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "heic" || ext === "heif") return "image/heic";
  return `image/${ext || "jpeg"}`;
}

function accepted(file: File): boolean {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return (file.type.startsWith("image/") && file.type !== "image/svg+xml") || file.type === "application/pdf" || EXTENSIONS.includes(ext);
}

export default function OrderBuilder({ slug, storeId, customerId, config }: { slug: string; storeId: number; customerId: number; config: StoreConfig }) {
  const firstSize = config.sizes[0];
  const [items, setItems] = useState<Item[]>([]);
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const queue = useRef<{ id: number; file: File }[]>([]);
  const busy = useRef(false);
  const nextId = useRef(1);
  const input = useRef<HTMLInputElement>(null);

  const update = (id: number, patch: Partial<Item>) => setItems((list) => list.map((i) => (i.id === id ? { ...i, ...patch } : i)));

  async function pump() {
    if (busy.current) return;
    const job = queue.current.shift();
    if (!job) return;
    busy.current = true;
    const { id, file } = job;
    try {
      const pathname = `loja/${storeId}/${customerId}/${randomFolder()}/${safeFileName(file.name)}`;
      await upload(pathname, file, {
        access: "private",
        handleUploadUrl: "/api/loja/upload",
        clientPayload: slug,
        contentType: contentTypeOf(file),
        multipart: file.size > 8 * 1024 * 1024,
        onUploadProgress: ({ percentage }) => update(id, { progress: Math.round(percentage) }),
      });
      update(id, { state: "checking", progress: 100, message: "Contando páginas…" });
      const response = await fetch("/api/loja/arquivo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, pathname }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body.file) throw new Error(body.error || "Não foi possível ler o arquivo.");
      update(id, { state: "ready", message: "", file: body.file as Checked });
    } catch (e) {
      let message = e instanceof Error ? e.message : "";
      if (!message || /fetch|network|Failed/i.test(message)) message = "Sem conexão. Confira a internet e tente de novo.";
      update(id, { state: "error", message });
    } finally {
      busy.current = false;
      pump();
    }
  }

  function addFiles(list: FileList | null) {
    if (!list) return;
    setError("");
    const room = MAX_ORDER_FILES - items.length - queue.current.length;
    const files = Array.from(list).slice(0, Math.max(0, room));
    if (list.length > files.length) setError(`Até ${MAX_ORDER_FILES} arquivos por pedido.`);
    const added: Item[] = [];
    for (const file of files) {
      const id = nextId.current++;
      const base: Item = {
        id, name: file.name, state: "sending", progress: 0, message: "Enviando…",
        paper: firstSize.id, color: firstSize.pb === null, copies: 1, extras: [],
      };
      if (!accepted(file)) added.push({ ...base, state: "error", message: "Envie apenas fotos ou PDF." });
      else if (file.size > MAX_BYTES) added.push({ ...base, state: "error", message: "Arquivo grande demais. O limite é 50 MB." });
      else {
        added.push(base);
        queue.current.push({ id, file });
      }
    }
    setItems((current) => [...current, ...added]);
    pump();
  }

  function price(item: Item) {
    if (!item.file) return null;
    return priceItem(config, { pages: item.file.pages, paper: item.paper, color: item.color, copies: item.copies, extras: item.extras });
  }

  const ready = items.filter((i) => i.state === "ready");
  const pending = items.some((i) => i.state === "sending" || i.state === "checking");
  const prices = ready.map(price);
  const problem = prices.find((p) => p && "error" in p) as { error: string } | undefined;
  const total = prices.reduce((sum, p) => sum + (p && "cents" in p ? p.cents : 0), 0);

  async function submit() {
    setError("");
    if (!ready.length) return setError("Envie pelo menos um arquivo.");
    if (pending) return setError("Espere os arquivos terminarem de enviar.");
    if (problem) return setError(problem.error);
    setSending(true);
    try {
      const response = await fetch("/api/loja/pedido", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug,
          note,
          total,
          items: ready.map((i) => ({ ...i.file, paper: i.paper, color: i.color, copies: i.copies, extras: i.extras })),
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body.code) throw new Error(body.error || "Não foi possível criar o pedido.");
      window.location.href = `/loja/${slug}/pedido/${body.code}`;
    } catch (e) {
      setError(e instanceof Error && e.message && !/fetch|network/i.test(e.message) ? e.message : "Sem conexão. Tente de novo.");
      setSending(false);
    }
  }

  return (
    <div className="order-builder">
      <div
        className={`drop${dragging ? " drop-on" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files); }}
      >
        <p><b>Escolha fotos ou PDF</b></p>
        <p className="small muted">Até {MAX_ORDER_FILES} arquivos, 50 MB cada.</p>
        <button type="button" className="btn btn-primary" onClick={() => input.current?.click()}>Escolher arquivos</button>
        <input
          ref={input}
          type="file"
          hidden
          multiple
          accept="application/pdf,image/jpeg,image/png,image/heic,image/heif,image/webp,.pdf,.jpg,.jpeg,.png,.heic,.heif,.webp"
          onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }}
        />
      </div>

      {items.length > 0 && (
        <ul className="order-items">
          {items.map((item) => {
            const p = price(item);
            const size = config.sizes.find((s) => s.id === item.paper) ?? firstSize;
            return (
              <li key={item.id} className="card order-item">
                <div className="order-item-head">
                  <div className="order-file">
                    <span className="file-badge">{item.file?.kind === "pdf" || item.name.toLowerCase().endsWith(".pdf") ? "PDF" : "FOTO"}</span>
                    <span className="file-name">{item.name}</span>
                  </div>
                  <button type="button" className="btn btn-sm" onClick={() => setItems((l) => l.filter((x) => x.id !== item.id))}
                          disabled={item.state === "sending" || item.state === "checking"}>Remover</button>
                </div>
                {item.state === "sending" && <div className="progress" aria-label="Enviando"><span style={{ width: `${item.progress}%` }} /></div>}
                {item.state !== "ready" && item.message && (
                  <p className={item.state === "error" ? "small bad" : "small muted"}>{item.message}</p>
                )}
                {item.state === "ready" && item.file && (
                  <div className="order-options">
                    <p className="small muted">{item.file.pages} {item.file.pages === 1 ? "página" : "páginas"}</p>
                    <div className="field">
                      <label>Formato</label>
                      <select value={item.paper} onChange={(e) => {
                        const s = config.sizes.find((x) => x.id === e.target.value)!;
                        update(item.id, { paper: s.id, color: s.pb === null ? true : s.color === null ? false : item.color });
                      }}>
                        {config.sizes.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                    </div>
                    <div className="field">
                      <label>Cor</label>
                      <div className="segmented" role="group">
                        <button type="button" aria-pressed={!item.color} disabled={size.pb === null} onClick={() => update(item.id, { color: false })}>
                          Preto e branco
                        </button>
                        <button type="button" aria-pressed={item.color} disabled={size.color === null} onClick={() => update(item.id, { color: true })}>
                          Colorido
                        </button>
                      </div>
                    </div>
                    <div className="field">
                      <label htmlFor={`copias-${item.id}`}>Cópias</label>
                      <input id={`copias-${item.id}`} type="number" min={1} max={MAX_COPIES} value={item.copies}
                             onChange={(e) => update(item.id, { copies: Math.max(1, Math.min(MAX_COPIES, Number(e.target.value) || 1)) })} />
                    </div>
                    {config.extras.length > 0 && (
                      <fieldset className="extras">
                        <legend>Adicionais</legend>
                        {config.extras.map((x) => (
                          <label key={x.id} className="check">
                            <input type="checkbox" checked={item.extras.includes(x.id)}
                                   onChange={(e) => update(item.id, { extras: e.target.checked ? [...item.extras, x.id] : item.extras.filter((v) => v !== x.id) })} />
                            {x.name} <span className="muted small">{x.cents === 0 ? "sem custo" : `${priceLabel(x.cents)} ${UNIT_LABEL[x.unit]}`}</span>
                          </label>
                        ))}
                      </fieldset>
                    )}
                    <p className="item-price">{p && "cents" in p ? priceLabel(p.cents) : <span className="bad small">{p?.error}</span>}</p>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="card order-summary">
        <div className="field">
          <label htmlFor="obs">Observação para a loja (opcional)</label>
          <textarea id="obs" maxLength={300} rows={2} value={note} onChange={(e) => setNote(e.target.value)}
                    placeholder="Ex.: grampear as folhas" />
        </div>
        <div className="order-total">
          <span>Total</span>
          <b className="num">{priceLabel(total)}</b>
        </div>
        {error && <p className="notice notice-err" role="alert">{error}</p>}
        <button type="button" className="btn btn-primary btn-lg" onClick={submit} disabled={sending || pending || !ready.length || !!problem}>
          {sending ? "Gerando Pix…" : "Pagar com Pix"}
        </button>
        <p className="small muted">O Pix vale por 30 minutos. A loja só recebe os arquivos depois do pagamento.</p>
      </div>
    </div>
  );
}
