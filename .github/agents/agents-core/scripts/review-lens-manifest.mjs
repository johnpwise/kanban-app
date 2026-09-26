#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCHEMA_VERSION = 1;
const REFERENCE_ROOT = "references";
const SKIP_REASON = "NO_TRIGGER_IN_DIFF_OR_SLICE_SPEC";

export const STACK_LENSES = Object.freeze({
  react: ["correctness", "accessibility", "react-composition", "state-ownership", "api-contracts"],
  vue: ["correctness", "accessibility", "vue-composition", "state-ownership", "api-contracts"],
  nextjs: [
    "correctness",
    "accessibility",
    "react-composition",
    "state-ownership",
    "api-contracts",
    "nextjs-boundary",
  ],
  "node-express": [
    "correctness",
    "api-contracts",
    "route-boundary",
    "persistence",
    "error-observability",
  ],
  "node-express-ts": [
    "correctness",
    "api-contracts",
    "route-boundary",
    "persistence",
    "error-observability",
  ],
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stableValue(value[key])]),
    );
  }
  return value;
}

function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function manifestHash(manifest) {
  const { hash: _hash, ...body } = manifest;
  return sha256(stableJson(body));
}

function referenceFor(lens) {
  return `${REFERENCE_ROOT}/${lens}.md`;
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function flattenStrings(value, result = []) {
  if (typeof value === "string") result.push(value);
  else if (Array.isArray(value)) value.forEach((entry) => flattenStrings(entry, result));
  else if (value !== null && typeof value === "object") {
    Object.values(value).forEach((entry) => flattenStrings(entry, result));
  }
  return result;
}

function normalizePath(path) {
  return path.replaceAll("\\", "/").replace(/^\.\//, "");
}

function uniqueSorted(values) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

export function parseUnifiedDiff(diffText) {
  if (!isNonEmptyString(diffText)) return [];
  const paths = [];

  for (const line of diffText.split(/\r?\n/)) {
    const header = line.match(/^diff --git a\/(.+) b\/(.+)$/);
    if (header) {
      paths.push(normalizePath(header[2]));
      continue;
    }
    const createdOrChanged = line.match(/^\+\+\+ b\/(.+)$/);
    if (createdOrChanged) paths.push(normalizePath(createdOrChanged[1]));
  }

  return uniqueSorted(paths);
}

function isTestPath(path) {
  return /(^|\/)(__tests__|test|tests|e2e|cypress)(\/|$)|\.(test|spec)\.[^.]+$/i.test(path);
}

function isDocumentationOrMetadata(path) {
  return /(^|\/)(docs?|\.github)(\/|$)|\.(md|mdx|txt|json|ya?ml|toml|lock)$/i.test(path);
}

function isKnownSourcePath(path) {
  return /\.(c|cc|cpp|css|go|html|java|js|jsx|mjs|php|py|rb|rs|scss|ts|tsx|vue)$/i.test(path);
}

function hasMatch(value, patterns) {
  return patterns.some((pattern) => pattern.test(value));
}

function classifyContext(input) {
  const parsed = parseUnifiedDiff(input.diffText ?? "");
  const files = uniqueSorted([
    ...(Array.isArray(input.changedFiles) ? input.changedFiles.map(normalizePath) : []),
    ...parsed,
  ]);
  const productionFiles = files.filter((path) => !isTestPath(path) && !isDocumentationOrMetadata(path));
  const fileText = productionFiles.join("\n").toLowerCase();
  const diffText = String(input.diffText ?? "");
  const searchableDiff = diffText.toLowerCase();
  const sliceText = flattenStrings(input.sliceSpec ?? {}).join("\n").toLowerCase();
  const binaryOrOpaque = productionFiles.some((path) => !isKnownSourcePath(path)) ||
    /binary files .* differ|git binary patch/i.test(diffText) ||
    (productionFiles.length > 0 && !isNonEmptyString(diffText));

  return {
    files,
    productionFiles,
    fileText,
    diffText: searchableDiff,
    sliceText,
    binaryOrOpaque,
  };
}

function trigger(reasonCode, evidence) {
  return { disposition: "include", reasonCodes: [reasonCode], evidence: uniqueSorted(evidence) };
}

function skip() {
  return { disposition: "skip", reasonCodes: [SKIP_REASON], evidence: [] };
}

function classifyAccessibility(context) {
  const hasUiFile = hasMatch(context.fileText, [/\.(jsx|tsx|vue)$/i, /(^|\/)(components?|views?|pages?|layouts?)(\/|$)/i]);
  if (!hasUiFile) return skip();
  if (hasMatch(context.diffText, [
    /<\/?(a|button|dialog|form|input|label|select|textarea)\b/,
    /\baria-[a-z-]+\b/,
    /\b(onclick|onsubmit|onkeydown|onkeyup|@click|@submit|tabindex|autofocus)\b/,
  ])) return trigger("DIFF_CONTENT_TRIGGER", ["interactive-ui-change"]);
  if (hasMatch(context.sliceText, [/keyboard|focus|screen reader|accessible|interactive|form|dialog|aria/])) {
    return trigger("SLICE_SPEC_TRIGGER", ["interactive-ui-slice-signal"]);
  }
  return skip();
}

function classifyComposition(context, stack) {
  const isVue = stack === "vue";
  const pathPatterns = isVue
    ? [/(^|\/)(components?|composables?|views?)(\/|$)/, /\.vue$/]
    : [/(^|\/)(components?|hooks?|contexts?|providers?|views?|pages?|layouts?)(\/|$)/, /\.(jsx|tsx)$/];
  const contentPatterns = isVue
    ? [/\b(definecomponent|defineprops|defineemits|provide|inject)\b/, /\buse[a-z0-9_]*\s*\(/]
    : [/\b(createcontext|usecontext)\b/, /\bfunction\s+[a-z][a-z0-9_]*\s*\(/, /\buse[a-z0-9_]*\s*\(/, /=>\s*</];
  if (hasMatch(context.fileText, pathPatterns)) return trigger("DIFF_PATH_TRIGGER", ["composition-boundary-path"]);
  if (hasMatch(context.diffText, contentPatterns)) return trigger("DIFF_CONTENT_TRIGGER", ["composition-boundary-change"]);
  return skip();
}

function classifyStateOwnership(context) {
  if (hasMatch(context.fileText, [/(^|\/)(store|state|context|provider|composables?)(\/|\.|$)/])) {
    return trigger("DIFF_PATH_TRIGGER", ["state-ownership-path"]);
  }
  if (hasMatch(context.diffText, [
    /\b(createcontext|usecontext|usereducer|provider|provide|inject|pinia|zustand|redux)\b/,
    /\b(shared|global|cross[-_ ]feature)[-_ ]?state\b/,
  ])) return trigger("DIFF_CONTENT_TRIGGER", ["shared-state-change"]);
  if (context.productionFiles.length > 0 && hasMatch(context.sliceText, [
    /shared_client_state_tier[\s\S]*cross_feature/,
    /shared client state|cross[-_ ]feature state|state is lifted|shared across features/,
  ])) return trigger("SLICE_SPEC_TRIGGER", ["shared-state-slice-signal"]);
  return skip();
}

function classifyApiContracts(context) {
  if (hasMatch(context.fileText, [/(^|\/)(api|apis|routes?|controllers?|dtos?|schemas?|clients?)(\/|\.|-|$)/])) {
    return trigger("DIFF_PATH_TRIGGER", ["api-contract-path"]);
  }
  if (hasMatch(context.diffText, [
    /\b(fetch|request|response|status|json|dto|schema|zod|nullable|nullability|openapi)\b/,
    /\b(router|app)\.(get|post|put|patch|delete)\s*\(/,
    /\bpromise\s*</,
  ])) return trigger("DIFF_CONTENT_TRIGGER", ["api-contract-change"]);
  if (context.productionFiles.length > 0 && hasMatch(context.sliceText, [
    /request\/response|response data|api contract|http status|status code|server action|route handler/,
  ])) return trigger("SLICE_SPEC_TRIGGER", ["api-contract-slice-signal"]);
  return skip();
}

function classifyNextBoundary(context) {
  if (hasMatch(context.fileText, [
    /(^|\/)app\/.*\/(route|actions?)\.(js|jsx|ts|tsx)$/,
    /(^|\/)(server|client|actions?)(\/|\.|-|$)/,
  ])) return trigger("DIFF_PATH_TRIGGER", ["nextjs-boundary-path"]);
  if (hasMatch(context.diffText, [
    /["']use (client|server)["']/,
    /\bserver-only\b/,
    /\b(nextrequest|nextresponse|revalidatepath|revalidatetag)\b/,
  ])) return trigger("DIFF_CONTENT_TRIGGER", ["nextjs-boundary-change"]);
  return skip();
}

function backendLayers(context) {
  const layers = new Set();
  if (hasMatch(context.fileText, [/(^|\/)(routes?|controllers?|transport)(\/|\.|-|$)/])) layers.add("transport");
  if (hasMatch(context.fileText, [/(^|\/)(services?|use-cases?|domain)(\/|\.|-|$)/])) layers.add("service");
  if (hasMatch(context.fileText, [/(^|\/)(repositories?|persistence|models?|migrations?)(\/|\.|-|$)/])) layers.add("persistence");
  return layers;
}

function classifyRouteBoundary(context) {
  const layers = backendLayers(context);
  if (layers.size >= 2) return trigger("DIFF_PATH_TRIGGER", [`cross-layer-change:${[...layers].sort().join("+")}`]);
  if (hasMatch(context.diffText, [
    /\b(req|request|res|response)\b[\s\S]*\b(repository|query|transaction)\b/,
    /\brouter\b[\s\S]*\b(insert|update|delete|select)\b/,
  ])) return trigger("DIFF_CONTENT_TRIGGER", ["mixed-route-boundary-signal"]);
  return skip();
}

function classifyPersistence(context) {
  if (hasMatch(context.fileText, [/(^|\/)(repositories?|persistence|models?|migrations?|database|db)(\/|\.|-|$)/])) {
    return trigger("DIFF_PATH_TRIGGER", ["persistence-path"]);
  }
  if (hasMatch(context.diffText, [
    /\b(transaction|commit|rollback|query|insert|upsert|migration|repository)\b/,
    /\b(select|update|delete)\s+.*\s+from\b/,
  ])) return trigger("DIFF_CONTENT_TRIGGER", ["persistence-change"]);
  return skip();
}

function classifyErrorObservability(context) {
  if (hasMatch(context.fileText, [/(^|\/)(errors?|logging|logger|metrics?|tracing)(\/|\.|-|$)/])) {
    return trigger("DIFF_PATH_TRIGGER", ["error-observability-path"]);
  }
  if (hasMatch(context.diffText, [
    /\b(catch|throw|error|logger|logging|metric|trace|retry|timeout|fallback)\b/,
    /\.status\s*\(\s*[45][0-9][0-9]\s*\)/,
  ])) return trigger("DIFF_CONTENT_TRIGGER", ["error-observability-change"]);
  return skip();
}

function classifyLens(lens, context, stack) {
  if (lens === "correctness") return trigger("ALWAYS_ON", []);
  if (context.binaryOrOpaque && context.productionFiles.length > 0) {
    return trigger("CLASSIFICATION_UNCERTAIN", ["opaque-production-change"]);
  }
  if (lens === "accessibility") return classifyAccessibility(context);
  if (lens === "react-composition" || lens === "vue-composition") return classifyComposition(context, stack);
  if (lens === "state-ownership") return classifyStateOwnership(context);
  if (lens === "api-contracts") return classifyApiContracts(context);
  if (lens === "nextjs-boundary") return classifyNextBoundary(context);
  if (lens === "route-boundary") return classifyRouteBoundary(context);
  if (lens === "persistence") return classifyPersistence(context);
  if (lens === "error-observability") return classifyErrorObservability(context);
  throw new Error(`unsupported lens ${lens}`);
}

export function generateReviewLensManifest(input) {
  if (!input || typeof input !== "object") throw new Error("review classification input must be an object");
  const inventory = STACK_LENSES[input.stack];
  if (!inventory) throw new Error(`unsupported stack ${JSON.stringify(input.stack)}`);
  const spec = input.sliceSpec;
  if (!spec || !isNonEmptyString(spec.sliceId) || !Number.isInteger(spec.revision)) {
    throw new Error("sliceSpec must provide sliceId and integer revision");
  }

  const context = classifyContext(input);
  const lenses = inventory.map((id) => ({
    id,
    reference: referenceFor(id),
    ...classifyLens(id, context, input.stack),
  }));
  const manifest = {
    schemaVersion: SCHEMA_VERSION,
    stack: input.stack,
    sliceSpec: {
      sliceId: spec.sliceId,
      workflowId: spec.workflowId ?? null,
      revision: spec.revision,
      hash: sha256(stableJson(spec)),
    },
    diff: {
      files: context.files,
      hash: sha256(`${context.files.join("\n")}\n--DIFF--\n${input.diffText ?? ""}`),
    },
    lenses,
    loadReferences: lenses
      .filter(({ disposition }) => disposition === "include")
      .map(({ reference }) => reference),
  };
  manifest.hash = manifestHash(manifest);
  assertReviewLensManifest(manifest);
  return manifest;
}

export function addReviewLenses(manifest, additions) {
  assertReviewLensManifest(manifest);
  if (!Array.isArray(additions)) throw new Error("additions must be an array");
  const next = clone(manifest);

  for (const addition of additions) {
    if (addition?.action !== undefined && addition.action !== "add") {
      throw new Error("the model may add lenses but never remove them");
    }
    if (!isNonEmptyString(addition?.id) || !isNonEmptyString(addition?.rationale)) {
      throw new Error("each model addition requires a lens id and rationale");
    }
    const lens = next.lenses.find(({ id }) => id === addition.id);
    if (!lens) throw new Error(`lens ${addition.id} is not available for stack ${next.stack}`);
    if (lens.disposition === "skip") {
      lens.disposition = "include";
      lens.reasonCodes = ["MODEL_ADDED"];
      lens.evidence = [`model-rationale:${addition.rationale.trim()}`];
    } else if (!lens.evidence.includes(`model-rationale:${addition.rationale.trim()}`)) {
      lens.reasonCodes = uniqueSorted([...lens.reasonCodes, "MODEL_ADDED"]);
      lens.evidence = uniqueSorted([...lens.evidence, `model-rationale:${addition.rationale.trim()}`]);
    }
  }

  next.loadReferences = next.lenses
    .filter(({ disposition }) => disposition === "include")
    .map(({ reference }) => reference);
  next.hash = manifestHash(next);
  assertReviewLensManifest(next);
  return next;
}

export function validateReviewLensManifest(manifest) {
  const errors = [];
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    return ["manifest must be an object"];
  }
  if (manifest.schemaVersion !== SCHEMA_VERSION) errors.push(`schemaVersion must be ${SCHEMA_VERSION}`);
  const inventory = STACK_LENSES[manifest.stack];
  if (!inventory) errors.push(`unsupported stack ${JSON.stringify(manifest.stack)}`);
  if (!manifest.sliceSpec || !isNonEmptyString(manifest.sliceSpec.sliceId)) errors.push("sliceSpec.sliceId is required");
  if (!Number.isInteger(manifest.sliceSpec?.revision)) errors.push("sliceSpec.revision must be an integer");
  if (!/^[a-f0-9]{64}$/.test(manifest.sliceSpec?.hash ?? "")) errors.push("sliceSpec.hash must be SHA-256");
  if (!Array.isArray(manifest.diff?.files)) errors.push("diff.files must be an array");
  if (!/^[a-f0-9]{64}$/.test(manifest.diff?.hash ?? "")) errors.push("diff.hash must be SHA-256");
  if (!Array.isArray(manifest.lenses)) errors.push("lenses must be an array");

  if (inventory && Array.isArray(manifest.lenses)) {
    const ids = manifest.lenses.map(({ id }) => id);
    if (JSON.stringify(ids) !== JSON.stringify(inventory)) errors.push("lenses must match canonical stack order and inventory");
    manifest.lenses.forEach((lens, index) => {
      if (lens.reference !== referenceFor(lens.id)) errors.push(`lenses[${index}].reference is not canonical`);
      if (!['include', 'skip'].includes(lens.disposition)) errors.push(`lenses[${index}].disposition is invalid`);
      if (!Array.isArray(lens.reasonCodes) || lens.reasonCodes.length === 0) errors.push(`lenses[${index}].reasonCodes is required`);
      if (!Array.isArray(lens.evidence)) errors.push(`lenses[${index}].evidence must be an array`);
      if (lens.id === "correctness" && lens.disposition !== "include") errors.push("correctness must always be included");
      if (lens.disposition === "skip" && !lens.reasonCodes?.every((code) => /^[A-Z][A-Z0-9_]+$/.test(code))) {
        errors.push(`lenses[${index}] skip reasons must be machine reason codes`);
      }
    });
    const expectedReferences = manifest.lenses
      .filter(({ disposition }) => disposition === "include")
      .map(({ reference }) => reference);
    if (JSON.stringify(manifest.loadReferences) !== JSON.stringify(expectedReferences)) {
      errors.push("loadReferences must contain exactly the included lens references in canonical order");
    }
  }
  if (!/^[a-f0-9]{64}$/.test(manifest.hash ?? "")) errors.push("hash must be SHA-256");
  else if (manifest.hash !== manifestHash(manifest)) errors.push("hash does not match manifest content");
  return errors;
}

export function assertReviewLensManifest(manifest) {
  const errors = validateReviewLensManifest(manifest);
  if (errors.length > 0) throw new Error(`invalid review-lens manifest:\n- ${errors.join("\n- ")}`);
  return manifest;
}

function parseArgs(argv) {
  const [command, ...tokens] = argv;
  const options = { command, lens: [], changedFile: [] };
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const key = token.replace(/^--/, "").replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    if (token === "--lens" || token === "--changed-file") options[key].push(tokens[++index]);
    else if (token.startsWith("--")) options[key] = tokens[++index];
  }
  return options;
}

function writeOutput(path, value) {
  const content = `${JSON.stringify(value, null, 2)}\n`;
  if (!path || path === "-") {
    process.stdout.write(content);
    return;
  }
  const destination = resolve(path);
  const directory = dirname(destination);
  const temporaryPath = join(directory, `.${randomUUID()}.review-lens-manifest.tmp`);
  mkdirSync(directory, { recursive: true });
  writeFileSync(temporaryPath, content, { encoding: "utf8", mode: 0o600 });
  renameSync(temporaryPath, destination);
}

function usage() {
  return [
    "Usage:",
    "  review-lens-manifest.mjs classify --stack <stack> --spec <slice-spec.json> --diff <diff.patch> [--output <manifest.json>]",
    "  review-lens-manifest.mjs add --manifest <manifest.json> --lens <id>:<rationale> [--lens ...] [--output <manifest.json>]",
    "  review-lens-manifest.mjs validate --manifest <manifest.json>",
  ].join("\n");
}

export function runReviewLensManifestCli(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  try {
    if (options.command === "classify") {
      if (!options.stack || !options.spec || (!options.diff && options.changedFile.length === 0)) throw new Error(usage());
      const manifest = generateReviewLensManifest({
        stack: options.stack,
        sliceSpec: JSON.parse(readFileSync(options.spec, "utf8")),
        changedFiles: options.changedFile,
        diffText: options.diff ? readFileSync(options.diff, "utf8") : "",
      });
      writeOutput(options.output, manifest);
      return manifest;
    }
    if (options.command === "add") {
      if (!options.manifest || options.lens.length === 0) throw new Error(usage());
      const current = JSON.parse(readFileSync(options.manifest, "utf8"));
      const additions = options.lens.map((entry) => {
        const separator = entry.indexOf(":");
        if (separator < 1) throw new Error(`invalid --lens ${JSON.stringify(entry)}; expected <id>:<rationale>`);
        return { id: entry.slice(0, separator), rationale: entry.slice(separator + 1) };
      });
      const next = addReviewLenses(current, additions);
      writeOutput(options.output ?? options.manifest, next);
      return next;
    }
    if (options.command === "validate") {
      if (!options.manifest) throw new Error(usage());
      assertReviewLensManifest(JSON.parse(readFileSync(options.manifest, "utf8")));
      process.stdout.write("Review-lens manifest is valid.\n");
      return true;
    }
    throw new Error(usage());
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
    return null;
  }
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  runReviewLensManifestCli();
}
