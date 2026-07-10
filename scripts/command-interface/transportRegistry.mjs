/**
 * Transport registry — add new transports without changing orchestrator.
 */
import { createSlackTransport, loadSlackConfig } from "./transports/slack.mjs";

/** @typedef {import('./types.mjs').Transport} Transport */

/**
 * @param {'slack'} name
 * @param {Record<string, string | undefined>} [env]
 * @returns {Transport}
 */
export function createTransport(name, env = process.env) {
  switch (name) {
    case "slack":
      return createSlackTransport(loadSlackConfig(env));
    default:
      throw new Error(`Unknown transport: ${name}`);
  }
}
