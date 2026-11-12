import { describe, expect, test } from "bun:test";
import { zipSync } from "fflate";
import { applyBackup, buildBackup } from "@/services/dataMigration";

describe("backup export", () => {
  test("filename is timestamp-host-Backup and sortable", () => {
    const { filename, manifest } = buildBackup({});
    expect(filename).toMatch(/^\d{8}-\d{6}-[A-Za-z0-9._-]+-Backup\.zip$/);
    expect(manifest.version).toBe(1);
  });

  test("the manifest states what is deliberately excluded", () => {
    const { manifest } = buildBackup({});
    expect(manifest.includesDashboardUsers).toBe(false);
    expect(manifest.secrets).toBe("plaintext");
    expect(manifest.notes.join(" ")).toContain("Dashboard users are NOT included");
    expect(manifest.notes.join(" ")).toContain(".env is NOT included");
  });
});

describe("backup import safety", () => {
  const neverConnected = () => false;

  test("refuses a path that escapes the installation", () => {
    const zip = zipSync({ "../evil.txt": new Uint8Array([1, 2, 3]) });
    expect(() => applyBackup(zip, "skip", neverConnected)).toThrow(/unsafe path/i);
  });

  test("refuses absolute paths", () => {
    const zip = zipSync({ "/etc/passwd": new Uint8Array([1]) });
    expect(() => applyBackup(zip, "skip", neverConnected)).toThrow(/unsafe path/i);
  });

  test("refuses a file outside the whitelist", () => {
    const zip = zipSync({
      "manifest.json": new TextEncoder().encode(JSON.stringify({ version: 1 })),
      "src/index.ts": new Uint8Array([1]),
    });
    expect(() => applyBackup(zip, "skip", neverConnected)).toThrow(/unsafe path/i);
  });

  test("an empty archive is accepted and reports nothing imported", () => {
    const zip = zipSync({
      "manifest.json": new TextEncoder().encode(
        JSON.stringify({ version: 1, sessions: [], unreadable: [] }),
      ),
    });
    const report = applyBackup(zip, "skip", neverConnected);
    expect(report.imported).toEqual([]);
    expect(report.replaced).toEqual([]);
    expect(report.files).toBe(0);
  });
});
