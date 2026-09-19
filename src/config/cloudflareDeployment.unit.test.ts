import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

type PackageManifest = {
  scripts?: Record<string, string>;
};

type WranglerConfig = {
  main?: string;
  compatibility_date?: string;
  compatibility_flags?: string[];
  preview_urls?: boolean;
  secrets?: {
    required?: string[];
  };
  assets?: {
    binding?: string;
    directory?: string;
  };
};

const projectRoot = process.cwd();

describe("Cloudflare deployment configuration", () => {
  it("should expose build, production deploy, and preview upload commands", () => {
    // Arrange
    const packageManifest = JSON.parse(
      readFileSync(resolve(projectRoot, "package.json"), "utf8"),
    ) as PackageManifest;

    // Act
    const scripts = packageManifest.scripts;

    // Assert
    expect(scripts?.["build:vinext"]).toBe("vinext build");
    expect(scripts?.["deploy:cloudflare"]).toBe(
      "wrangler deploy --config dist/server/wrangler.json",
    );
    expect(scripts?.["preview:cloudflare"]).toBe(
      "wrangler versions upload --config dist/server/wrangler.json",
    );
  });

  it("should give Wrangler a vinext Worker entry point and asset directory", () => {
    // Arrange
    const wranglerPath = resolve(projectRoot, "wrangler.jsonc");

    // Act
    const hasWranglerConfig = existsSync(wranglerPath);

    // Assert
    expect(hasWranglerConfig).toBe(true);

    const wranglerConfig = JSON.parse(readFileSync(wranglerPath, "utf8")) as WranglerConfig;
    expect(wranglerConfig.main).toBe("./worker/index.ts");
    expect(existsSync(resolve(projectRoot, wranglerConfig.main!))).toBe(true);
    expect(wranglerConfig.assets).toEqual(
      expect.objectContaining({ binding: "ASSETS", directory: "dist/client" }),
    );
    expect(Number(wranglerConfig.compatibility_date?.replaceAll("-", ""))).toBeGreaterThanOrEqual(
      20260804,
    );
    expect(wranglerConfig.compatibility_flags).toContain("nodejs_compat");
    expect(wranglerConfig.preview_urls).toBe(true);
    expect(wranglerConfig.secrets?.required).toContain("FIREBASE_SERVICE_ACCOUNT_JSON");

    const workerEntry = readFileSync(resolve(projectRoot, wranglerConfig.main!), "utf8");
    expect(workerEntry).toContain('import "firebase-admin/auth"');
    expect(workerEntry).toContain('import "firebase-admin/firestore"');
    expect(workerEntry).toContain("prepareFirestoreProtobufTypes");
  });

  it("should adapt the App Router build for the Cloudflare Workers runtime", () => {
    // Arrange
    const viteConfigPath = resolve(projectRoot, "vite.config.ts");

    // Act
    const hasViteConfig = existsSync(viteConfigPath);

    // Assert
    expect(hasViteConfig).toBe(true);

    const viteConfig = readFileSync(viteConfigPath, "utf8");
    expect(viteConfig).toContain('import vinext from "vinext"');
    expect(viteConfig).toContain('import { cloudflare } from "@cloudflare/vite-plugin"');
    expect(viteConfig).toContain('name: "rsc"');
    expect(viteConfig).toContain('childEnvironments: ["ssr"]');
  });
});
