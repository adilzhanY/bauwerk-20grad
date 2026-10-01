import { createApp } from "./app";
import { createPool } from "./db";

const port = Number(process.env.PORT ?? 3000);
// Loopback by default: in development the app reaches it through the Vite proxy.
const host = process.env.HOST ?? "127.0.0.1";
// A promise nobody awaited that fails is logged, not allowed to stop the server for everyone.
process.on("unhandledRejection", (reason) => {
  console.error("unhandled rejection:", reason);
});
const app = await createApp(createPool());
app.enableShutdownHooks();
await app.listen(port, host);
console.log(`Bauwerk server listening on http://${host}:${port}`);
