#!/usr/bin/env node
// Abre um backup do Quioco (.qbk) com a chave privada e gera:
//   <arquivo>.json  — todas as tabelas, legível
//   <arquivo>.sql   — (com --sql) INSERTs para recarregar num banco vazio criado com db/schema.sql
//
// Uso:  node tools/restaurar-backup.mjs quioco-2026-11-08T06-00-00Z.qbk chave-privada.pem [--sql]
//
// Só usa o Node (22+), sem dependências. Mesmo formato de lib/backup-crypto.ts.
import { constants, createDecipheriv, privateDecrypt } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";

const MAGIC = Buffer.from("QBK1");

export function openBackup(file, privateKeyPem) {
  if (!file.subarray(0, 4).equals(MAGIC)) throw new Error("Não é um backup do Quioco.");
  const keyLength = file.readUInt16BE(4);
  let at = 6;
  const wrapped = file.subarray(at, (at += keyLength));
  const iv = file.subarray(at, (at += 12));
  const tag = file.subarray(at, (at += 16));
  const key = privateDecrypt({ key: privateKeyPem, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" }, wrapped);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAAD(MAGIC);
  decipher.setAuthTag(tag);
  return gunzipSync(Buffer.concat([decipher.update(file.subarray(at)), decipher.final()]));
}

const quote = (text) => `'${String(text).replace(/'/g, "''")}'`;
const ident = (name) => `"${String(name).replace(/"/g, '""')}"`;

function literal(value) {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) {
    const items = value.map((v) => (v === null ? "NULL" : `"${String(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`));
    return quote(`{${items.join(",")}}`);
  }
  if (typeof value === "object") return quote(JSON.stringify(value));
  return quote(value);
}

/** INSERTs in the export's order (parents first), then sequences moved past the restored ids. */
export function toSql(data) {
  const out = [`-- Backup do Quioco de ${data.created_at}`, "begin;"];
  for (const [table, { columns, rows }] of Object.entries(data.tables)) {
    if (!rows.length) continue;
    out.push(`\n-- ${table}: ${rows.length} linha(s)`);
    const cols = columns.map(ident).join(", ");
    for (const row of rows) out.push(`insert into ${ident(table)} (${cols}) values (${row.map(literal).join(", ")});`);
    if (columns.includes("id")) {
      out.push(`select setval(pg_get_serial_sequence(${quote(table)}, 'id'), (select max(id) from ${ident(table)}));`);
    }
  }
  out.push("commit;", "");
  return out.join("\n");
}

function main() {
  const [file, keyFile, ...flags] = process.argv.slice(2);
  if (!file || !keyFile) {
    console.error("Uso: node tools/restaurar-backup.mjs <arquivo.qbk> <chave-privada.pem> [--sql]");
    process.exit(1);
  }
  const data = JSON.parse(openBackup(readFileSync(file), readFileSync(keyFile, "utf8")).toString("utf8"));
  if (data.format !== "quioco-backup") throw new Error("Formato desconhecido.");
  const base = file.replace(/\.qbk$/, "");
  writeFileSync(`${base}.json`, JSON.stringify(data, null, 2));
  console.log(`Backup de ${data.created_at}`);
  for (const [table, { rows }] of Object.entries(data.tables)) console.log(`  ${table}: ${rows.length}`);
  console.log(`Gerado ${base}.json`);
  if (flags.includes("--sql")) {
    writeFileSync(`${base}.sql`, toSql(data));
    console.log(`Gerado ${base}.sql  (rode num banco vazio criado com db/schema.sql: psql "$URL" -f ${base}.sql)`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
