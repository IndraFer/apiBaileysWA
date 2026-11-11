import { afterEach, describe, expect, test } from "bun:test";
import config from "@/config";
import {
  buildWebSearchToolSchema,
  executeWebSearch,
  normalizeResults,
  safeResultUrl,
  stripHtml,
  WEB_SEARCH_TOOL_NAME,
} from "@/services/webSearch";

const originalFetch = globalThis.fetch;
const originalBaseUrl = config.searxng.baseUrl;

afterEach(() => {
  globalThis.fetch = originalFetch;
  config.searxng.baseUrl = originalBaseUrl;
});

describe("web search tool", () => {
  test("tool schema is a single required query parameter", () => {
    const schema = buildWebSearchToolSchema();
    expect(schema.function.name).toBe(WEB_SEARCH_TOOL_NAME);
    expect(schema.type).toBe("function");
    const params = schema.function.parameters as {
      properties: Record<string, unknown>;
      required: string[];
    };
    expect(Object.keys(params.properties)).toEqual(["query"]);
    expect(params.required).toEqual(["query"]);
  });

  test("unconfigured server refuses the call instead of failing silently", async () => {
    config.searxng.baseUrl = "";
    const result = await executeWebSearch({ query: "anything" });
    expect(result.ok).toBe(false);
    expect(result.content).toContain("not configured");
  });

  test("html is reduced to plain text", () => {
    expect(stripHtml("<b>Hello</b> &amp; <i>welcome</i>")).toBe("Hello & welcome");
    expect(stripHtml("a&nbsp;&nbsp;b")).toBe("a b");
    expect(stripHtml("  spaced   out  ")).toBe("spaced out");
  });

  test("only public http(s) result links survive", () => {
    expect(safeResultUrl("https://example.com/a")).toBe("https://example.com/a");
    expect(safeResultUrl("http://example.com")).toBe("http://example.com/");
    expect(safeResultUrl("javascript:alert(1)")).toBeNull();
    expect(safeResultUrl("file:///etc/passwd")).toBeNull();
    expect(safeResultUrl("http://127.0.0.1/admin")).toBeNull();
    expect(safeResultUrl("http://192.168.1.10/")).toBeNull();
    expect(safeResultUrl("http://localhost:8080/")).toBeNull();
    expect(safeResultUrl("not a url")).toBeNull();
    expect(safeResultUrl(undefined)).toBeNull();
  });

  test("results are deduplicated, bounded and strip private links", () => {
    const entries = normalizeResults(
      {
        results: [
          { title: "First", url: "https://example.com/1", content: "one" },
          { title: "Duplicate", url: "https://example.com/1", content: "dup" },
          { title: "Private", url: "http://10.0.0.5/secret", content: "nope" },
          { title: "Second", url: "https://example.com/2", content: "two" },
          { title: "Third", url: "https://example.com/3", content: "three" },
        ],
      },
      2,
    );
    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual({ title: "First", url: "https://example.com/1", snippet: "one" });
    expect(entries[1].url).toBe("https://example.com/2");
  });

  test("missing or malformed payloads yield no entries", () => {
    expect(normalizeResults(null, 5)).toEqual([]);
    expect(normalizeResults({}, 5)).toEqual([]);
    expect(normalizeResults({ results: "nope" }, 5)).toEqual([]);
  });

  test("a configured instance is queried and results are labelled untrusted", async () => {
    config.searxng.baseUrl = "http://127.0.0.1:8080";
    let requested = "";
    globalThis.fetch = (async (input: string | URL | Request) => {
      requested = String(input);
      return new Response(
        JSON.stringify({
          results: [
            {
              title: "<b>Jam operasional</b>",
              url: "https://example.com/jam",
              content: "Buka 08.00-17.00 &amp; tutup hari libur",
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;

    const result = await executeWebSearch({ query: "jam operasional" });
    expect(result.ok).toBe(true);
    expect(result.content).toContain("Untrusted web results");
    expect(result.content).toContain("Jam operasional");
    expect(result.content).toContain("https://example.com/jam");
    expect(requested).toContain("format=json");
    expect(requested).toContain("q=jam+operasional");
  });

  test("non-JSON answers explain the SearXNG format requirement", async () => {
    config.searxng.baseUrl = "http://127.0.0.1:8080";
    globalThis.fetch = (async () =>
      new Response("<html>disabled</html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      })) as unknown as typeof fetch;

    const result = await executeWebSearch({ query: "x" });
    expect(result.ok).toBe(false);
    expect(result.content).toContain("search.formats");
  });

  test("an empty query and an HTTP failure are reported as tool errors", async () => {
    config.searxng.baseUrl = "http://127.0.0.1:8080";
    expect((await executeWebSearch({ query: "   " })).ok).toBe(false);

    globalThis.fetch = (async () =>
      new Response("boom", { status: 502 })) as unknown as typeof fetch;
    const result = await executeWebSearch({ query: "anything" });
    expect(result.ok).toBe(false);
    expect(result.content).toContain("502");
  });
});
