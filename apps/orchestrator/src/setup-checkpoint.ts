import "dotenv/config";
import { createProductionCheckpointer } from "./checkpointer.js";

const connectionString = process.env["DATABASE_URL"];
if (!connectionString) {
  throw new Error("DATABASE_URL is required for checkpoint setup.");
}

const checkpointer = await createProductionCheckpointer({
  connectionString,
  setup: true,
});
await checkpointer.end();

console.log(JSON.stringify({ event: "graph.checkpoint_schema_ready" }));
