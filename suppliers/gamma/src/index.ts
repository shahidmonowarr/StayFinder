import { createApp, PORT } from "./app";

createApp().listen(PORT, () => {
  console.info(`[supplier-gamma] listening on http://localhost:${PORT}`);
});
