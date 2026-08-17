import { createApp, PORT } from "./app";

createApp().listen(PORT, () => {
  console.info(`[supplier-alpha] listening on http://localhost:${PORT}`);
});
