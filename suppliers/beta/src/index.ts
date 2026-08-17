import { createApp, PORT } from "./app";

createApp().listen(PORT, () => {
  console.info(`[supplier-beta] listening on http://localhost:${PORT}`);
});
