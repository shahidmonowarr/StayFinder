import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

/**
 * Vitest runs with `globals: false`, so Testing Library never installs its own
 * automatic cleanup — it registers that on a global `afterEach` that does not
 * exist here. Without this, every `render` accumulates in the same document and
 * queries start finding duplicates from earlier tests.
 */
afterEach(cleanup);
