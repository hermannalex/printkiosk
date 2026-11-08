import { neon } from "@neondatabase/serverless";

type Row = Record<string, any>;

let client: ReturnType<typeof neon> | null = null;

function getClient() {
  if (!client) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL não configurada.");
    client = neon(url);
  }
  return client;
}

/** Tagged-template query: `await sql\`select * from users where id = ${id}\`` */
export async function sql(strings: TemplateStringsArray, ...values: unknown[]): Promise<Row[]> {
  const result = await getClient()(strings, ...values);
  return result as Row[];
}

/** First row of a query, or null. */
export async function one(strings: TemplateStringsArray, ...values: unknown[]): Promise<Row | null> {
  const rows = await sql(strings, ...values);
  return rows[0] ?? null;
}
