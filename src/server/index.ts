import { join } from "node:path";
import { createConvergeServer } from "./app.js";
import { OperationJournal } from "./journal.js";
import { PostgresOperationJournal } from "./postgres-journal.js";
import type { OperationStore } from "./store.js";

const port = Number(process.env.PORT ?? 8787);
const dataDirectory = process.env.DATA_DIR ?? "./data";
const databaseUrl = process.env.DATABASE_URL;

const store: OperationStore = databaseUrl
  ? new PostgresOperationJournal(databaseUrl)
  : new OperationJournal(join(dataDirectory, "operations.ndjson"));

await store.load();
const app = createConvergeServer(store, { staticDirectory: process.env.STATIC_DIR ?? "./dist" });
await app.listen(port);
console.log(`Converge listening on http://localhost:${port} using ${databaseUrl ? "PostgreSQL" : "NDJSON"} storage`);

async function shutdown(): Promise<void> {
  await app.close();
  await store.close?.();
}

process.once("SIGTERM", () => void shutdown());
process.once("SIGINT", () => void shutdown());
