"use client";

import { upload } from "@vercel/blob/client";
import { useRef, useState } from "react";
import styles from "./relay.module.css";

type Row = { id: number; name: string; progress: number; state: "queued" | "sending" | "ok" | "error"; message: string };

const MAX_BYTES = 50 * 1024 * 1024;

function safeFileName(name: string): string {
  const cleaned = name
    .normalize("NFC")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(-100);
  return cleaned || "arquivo";
}

function randomFolder(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Date.now().toString(36) + Array.from(bytes, (b) => (b % 36).toString(36)).join("");
}

function isAccepted(file: File): boolean {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return file.type.startsWith("image/") || file.type === "application/pdf" ||
    ["pdf", "jpg", "jpeg", "png", "heic", "heif", "webp", "gif", "bmp"].includes(ext);
}

function contentTypeOf(file: File): string {
  if (file.type) return file.type;
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "pdf") return "application/pdf";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "heic" || ext === "heif") return "image/heic";
  return `image/${ext || "jpeg"}`;
}

export default function RelayUploader({ code, maxFiles }: { code: string; maxFiles: number }) {
  const [rows, setRows] = useState<Row[]>([]);
  const queue = useRef<{ id: number; file: File }[]>([]);
  const busy = useRef(false);
  const nextId = useRef(1);
  const input = useRef<HTMLInputElement>(null);

  const update = (id: number, patch: Partial<Row>) =>
    setRows((list) => list.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  async function pump() {
    if (busy.current) return;
    const job = queue.current.shift();
    if (!job) return;
    busy.current = true;
    const { id, file } = job;
    try {
      if (!isAccepted(file)) throw new Error("Envie apenas fotos ou arquivos PDF.");
      if (file.size > MAX_BYTES) throw new Error("Arquivo grande demais. O limite é 50 MB.");
      update(id, { state: "sending", message: "Enviando…" });
      await upload(`relay/${code}/${randomFolder()}/${safeFileName(file.name)}`, file, {
        access: "private",
        handleUploadUrl: "/api/relay/upload",
        clientPayload: code,
        contentType: contentTypeOf(file),
        multipart: file.size > 8 * 1024 * 1024,
        onUploadProgress: ({ percentage }) => update(id, { progress: Math.round(percentage) }),
      });
      update(id, { state: "ok", progress: 100, message: "Enviado" });
    } catch (error) {
      let message = error instanceof Error ? error.message : "";
      if (!message || /fetch|network|Failed/i.test(message)) message = "Sem conexão. Confira a internet do celular e tente de novo.";
      update(id, { state: "error", message });
    } finally {
      busy.current = false;
      pump();
    }
  }

  function pick(files: FileList | null) {
    if (!files) return;
    const added: Row[] = [];
    for (const file of Array.from(files)) {
      const id = nextId.current++;
      queue.current.push({ id, file });
      added.push({ id, name: file.name, progress: 0, state: "queued", message: "Na fila" });
    }
    setRows((list) => [...list, ...added].slice(-maxFiles * 2));
    if (input.current) input.current.value = "";
    pump();
  }

  const sent = rows.filter((r) => r.state === "ok").length;

  return (
    <>
      <label className={styles.pick} htmlFor="files">Escolher fotos ou PDF</label>
      <input
        id="files"
        ref={input}
        className={styles.file}
        type="file"
        multiple
        accept="image/*,application/pdf,.pdf"
        onChange={(e) => pick(e.target.files)}
      />
      <ul className={styles.list}>
        {rows.map((r) => (
          <li key={r.id} className={r.state === "ok" ? styles.done : undefined}>
            <div className={styles.row}>
              <span className={styles.name}>{r.name}</span>
              <span className={r.state === "ok" ? styles.stateOk : r.state === "error" ? styles.stateErr : styles.state}>{r.message}</span>
            </div>
            {r.state !== "error" && (
              <div className={styles.bar}>
                <span style={{ width: `${r.progress}%` }} />
              </div>
            )}
          </li>
        ))}
      </ul>
      {sent > 0 && (
        <p className={styles.summary}>
          {sent === 1 ? "1 arquivo enviado." : `${sent} arquivos enviados.`} Continue no quiosque.
        </p>
      )}
    </>
  );
}
