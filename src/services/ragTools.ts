/**
 * Simple, non-vector "RAG" tools configured per WhatsApp number.
 *
 * The model only chooses a tool name (from the configured list) and supplies
 * argument values; the URL always comes from configuration, never from the
 * model. Responses are truncated so a chatty endpoint cannot bloat the context.
 *
 * This is intentionally generic: any REST endpoint can be exposed — a member
 * lookup, an article search, a search engine, etc.
 */
import type { RagEndpointConfig } from "@/baileys/types";
import config from "@/config";
import { validateOutboundUrl } from "@/lib/urlGuard";
import { errorToString } from "@/utils/validation";

/** Per-endpoint credentials, stored encrypted in the session metadata. */
export interface ToolCredential {
  headers?: Record<string, string>;
  query?: Record<string, string>;
}

/** Endpoint name -> credential. */
export type ToolCredentials = Record<string, ToolCredential>;

/** One JSON-Schema property exposed to the model. */
export interface OpenAiToolProperty {
  type: "string" | "number" | "integer" | "boolean";
  description: string;
  enum?: string[];
  default?: string | number | boolean;
}

export interface OpenAiToolSchema {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, OpenAiToolProperty>;
      required: string[];
      additionalProperties: false;
    };
  };
}

export interface ToolExecution {
  ok: boolean;
  content: string;
}

/**
 * Convert configured endpoints into OpenAI-compatible tool schemas.
 * Each endpoint declares its own parameters (name, type, enum, required), so
 * nothing is hardcoded — a member lookup, an article search and a POST-to-
 * complaints endpoint can all coexist.
 */
export function buildToolSchemas(endpoints: RagEndpointConfig[] | undefined): OpenAiToolSchema[] {
  if (!endpoints || endpoints.length === 0) return [];
  return endpoints.map((endpoint) => {
    const params = endpoint.params ?? [];
    const properties: Record<string, OpenAiToolProperty> = {};
    for (const param of params) {
      properties[param.name] = {
        type: param.type === "integer" ? "integer" : param.type,
        description: param.description,
        ...(param.enum && param.enum.length > 0 ? { enum: param.enum } : {}),
        ...(param.default !== undefined ? { default: param.default } : {}),
      };
    }
    return {
      type: "function",
      function: {
        name: endpoint.name,
        description: endpoint.description,
        parameters: {
          type: "object",
          properties,
          required: params.filter((param) => param.required).map((param) => param.name),
          additionalProperties: false,
        },
      },
    };
  });
}

/** Find a configured endpoint by tool name. */
export function findEndpoint(
  endpoints: RagEndpointConfig[] | undefined,
  name: string,
): RagEndpointConfig | undefined {
  return endpoints?.find((endpoint) => endpoint.name === name);
}

/**
 * Execute one tool call. Never throws: failures are returned as `ok: false`
 * with a short message the model can relay to the customer.
 *
 * Values go where each parameter declares (`in`), defaulting to query for GET
 * and JSON body for POST. Path placeholders like `/members/{member_number}`
 * are substituted after encoding.
 */
export async function executeTool(
  endpoint: RagEndpointConfig,
  args: Record<string, unknown>,
  credential?: ToolCredential,
): Promise<ToolExecution> {
  const params = endpoint.params ?? [];
  const query: Record<string, string> = { ...(credential?.query ?? {}) };
  const body: Record<string, unknown> = {};
  const pathValues: Record<string, string> = {};

  for (const param of params) {
    const raw = args[param.name] ?? param.default;
    const missing = raw === undefined || raw === null || raw === "";
    if (missing) {
      if (param.required) {
        return { ok: false, content: `Tool error: missing required parameter "${param.name}"` };
      }
      continue;
    }
    const location = param.in ?? (endpoint.method === "GET" ? "query" : "body");
    if (location === "path") {
      pathValues[param.name] = encodeURIComponent(String(raw));
    } else if (location === "query") {
      query[param.name] = String(raw);
    } else {
      body[param.name] = raw;
    }
  }

  const urlWithPath = endpoint.url.replace(/\{(\w+)\}/g, (match, key: string) =>
    pathValues[key] !== undefined ? pathValues[key] : match,
  );

  let target: URL;
  try {
    target = new URL(urlWithPath);
  } catch {
    return { ok: false, content: "Tool error: endpoint URL is invalid" };
  }
  for (const [key, value] of Object.entries(query)) {
    target.searchParams.set(key, value);
  }

  const url = target.toString();
  const invalid = validateOutboundUrl(url, { blockInternal: config.ai.toolBlockInternal });
  if (invalid) return { ok: false, content: `Tool error: ${invalid}` };

  const headers: Record<string, string> = {
    Accept: "application/json",
    ...(credential?.headers ?? {}),
  };
  const init: RequestInit = {
    method: endpoint.method,
    headers,
    signal: AbortSignal.timeout(endpoint.timeoutMs ?? config.ai.toolTimeoutMs),
  };
  if (endpoint.method !== "GET" && Object.keys(body).length > 0) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }

  try {
    const response = await fetch(url, init);
    const raw = await response.text();
    const limit = endpoint.maxResponseChars ?? config.ai.toolMaxResponseChars;
    const text = raw.length > limit ? `${raw.slice(0, limit)}…[truncated]` : raw;
    if (!response.ok) {
      return { ok: false, content: `Tool error: HTTP ${response.status} ${text}` };
    }
    return { ok: true, content: text };
  } catch (error) {
    return { ok: false, content: `Tool error: ${errorToString(error)}` };
  }
}
