#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CONTEXT_FIELDS = {
  stacks: "stack",
  requestTypes: "requestType",
  phases: "phase",
};

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

function readJson(path, label) {
  if (!existsSync(path)) throw new Error(`Missing ${label}: ${path}`);

  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`Invalid JSON in ${label} ${path}: ${error.message}`);
  }
}

function assertNonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
}

function assertStringArray(value, label, { allowEmpty = true } = {}) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    throw new Error(`${label} must be ${allowEmpty ? "an" : "a non-empty"} array`);
  }

  const seen = new Set();
  value.forEach((item) => {
    assertNonEmptyString(item, `${label} item`);
    if (seen.has(item)) throw new Error(`${label} contains duplicate value: ${item}`);
    seen.add(item);
  });
}

function assertWhen(when, label, supported) {
  if (when === undefined) return;
  if (!when || typeof when !== "object" || Array.isArray(when)) {
    throw new Error(`${label} must be an object`);
  }

  const allowed = new Set(["stacks", "requestTypes", "phases", "triggersAll", "triggersAny"]);
  Object.keys(when).forEach((key) => {
    if (!allowed.has(key)) throw new Error(`${label} contains unsupported selector: ${key}`);
  });

  for (const [plural, singular] of Object.entries(CONTEXT_FIELDS)) {
    if (when[plural] === undefined) continue;
    assertStringArray(when[plural], `${label}.${plural}`, { allowEmpty: false });
    when[plural].forEach((value) => {
      if (!supported[plural].includes(value)) {
        throw new Error(`${label}.${plural} contains unsupported ${singular}: ${value}`);
      }
    });
  }

  for (const key of ["triggersAll", "triggersAny"]) {
    if (when[key] === undefined) continue;
    assertStringArray(when[key], `${label}.${key}`, { allowEmpty: false });
    when[key].forEach((trigger) => {
      if (!supported.triggers.includes(trigger)) {
        throw new Error(`${label}.${key} contains unsupported trigger: ${trigger}`);
      }
    });
  }
}

function assertManifest(manifest) {
  if (manifest?.schemaVersion !== 1) {
    throw new Error(`Unsupported instruction manifest schemaVersion: ${manifest?.schemaVersion ?? "<missing>"}`);
  }
  assertNonEmptyString(manifest.compilerId, "compilerId");

  if (!manifest.supported || typeof manifest.supported !== "object") {
    throw new Error("Manifest must declare supported selections");
  }
  for (const key of ["stacks", "requestTypes", "phases", "triggers"]) {
    assertStringArray(manifest.supported[key], `supported.${key}`, {
      allowEmpty: key === "triggers",
    });
  }

  if (!Array.isArray(manifest.layers) || manifest.layers.length === 0) {
    throw new Error("Manifest must declare at least one precedence layer");
  }
  const layers = new Map();
  const precedences = new Set();
  manifest.layers.forEach((layer, index) => {
    assertNonEmptyString(layer?.id, `layers[${index}].id`);
    if (!Number.isInteger(layer.precedence)) {
      throw new Error(`layers[${index}].precedence must be an integer`);
    }
    if (layers.has(layer.id)) throw new Error(`Duplicate layer id: ${layer.id}`);
    if (precedences.has(layer.precedence)) {
      throw new Error(`Duplicate layer precedence: ${layer.precedence}`);
    }
    layers.set(layer.id, layer.precedence);
    precedences.add(layer.precedence);
  });

  if (!Array.isArray(manifest.fragments) || manifest.fragments.length === 0) {
    throw new Error("Manifest must declare at least one fragment");
  }
  const fragmentIds = new Set();
  const fragmentsById = new Map();
  manifest.fragments.forEach((fragment, index) => {
    const label = `fragments[${index}]`;
    assertNonEmptyString(fragment?.id, `${label}.id`);
    assertNonEmptyString(fragment?.policyId, `${label}.policyId`);
    assertNonEmptyString(fragment?.layer, `${label}.layer`);
    assertNonEmptyString(fragment?.path, `${label}.path`);
    if (fragmentIds.has(fragment.id)) throw new Error(`Duplicate fragment id: ${fragment.id}`);
    if (!layers.has(fragment.layer)) throw new Error(`${fragment.id} uses unknown layer: ${fragment.layer}`);
    if (fragment.protected !== undefined && typeof fragment.protected !== "boolean") {
      throw new Error(`${fragment.id}.protected must be boolean`);
    }
    if (fragment.overrides !== undefined) {
      assertStringArray(fragment.overrides, `${fragment.id}.overrides`, { allowEmpty: false });
    }
    assertWhen(fragment.when, `${fragment.id}.when`, manifest.supported);
    fragmentIds.add(fragment.id);
    fragmentsById.set(fragment.id, fragment);
  });

  manifest.fragments.forEach((fragment) => {
    (fragment.overrides ?? []).forEach((overriddenId) => {
      if (!fragmentIds.has(overriddenId)) {
        throw new Error(`${fragment.id} overrides unknown fragment: ${overriddenId}`);
      }
      if (overriddenId === fragment.id) throw new Error(`${fragment.id} cannot override itself`);
      const overridden = fragmentsById.get(overriddenId);
      if (overridden.policyId !== fragment.policyId) {
        throw new Error(
          `${fragment.id} cannot override ${overriddenId}: policy IDs differ (${fragment.policyId} != ${overridden.policyId})`,
        );
      }
      if (layers.get(fragment.layer) <= layers.get(overridden.layer)) {
        throw new Error(`${fragment.id} must have higher precedence than ${overriddenId}`);
      }
      if (overridden.protected) {
        throw new Error(
          `${fragment.id} cannot override protected policy ${overridden.policyId} from ${overriddenId}`,
        );
      }
    });
  });

  if (!Array.isArray(manifest.requirements) || manifest.requirements.length === 0) {
    throw new Error("Manifest must declare at least one omission-check requirement");
  }
  const requirementIds = new Set();
  manifest.requirements.forEach((requirement, index) => {
    const label = `requirements[${index}]`;
    assertNonEmptyString(requirement?.id, `${label}.id`);
    if (requirementIds.has(requirement.id)) {
      throw new Error(`Duplicate requirement id: ${requirement.id}`);
    }
    assertStringArray(requirement.policyIds, `${label}.policyIds`, { allowEmpty: false });
    requirement.policyIds.forEach((policyId) => {
      if (!manifest.fragments.some((fragment) => fragment.policyId === policyId)) {
        throw new Error(
          `Instruction omission check failed: ${requirement.id}:${policyId} (policy is undeclared)`,
        );
      }
    });
    assertWhen(requirement.when, `${requirement.id}.when`, manifest.supported);
    requirementIds.add(requirement.id);
  });

  return layers;
}

function normalizeSelection(selection, supported) {
  const normalized = {
    stack: selection?.stack,
    requestType: selection?.requestType,
    phase: selection?.phase,
    triggers: [...(selection?.triggers ?? [])].sort(),
  };

  for (const [plural, singular] of Object.entries(CONTEXT_FIELDS)) {
    assertNonEmptyString(normalized[singular], singular);
    if (!supported[plural].includes(normalized[singular])) {
      const display = singular === "requestType" ? "request type" : singular;
      throw new Error(`Unsupported ${display}: ${normalized[singular]}`);
    }
  }
  assertStringArray(normalized.triggers, "triggers");
  normalized.triggers.forEach((trigger) => {
    if (!supported.triggers.includes(trigger)) throw new Error(`Unsupported trigger: ${trigger}`);
  });

  return normalized;
}

function matches(when, selection) {
  if (!when) return true;
  for (const [plural, singular] of Object.entries(CONTEXT_FIELDS)) {
    if (when[plural] && !when[plural].includes(selection[singular])) return false;
  }
  const triggers = new Set(selection.triggers);
  if (when.triggersAll && !when.triggersAll.every((trigger) => triggers.has(trigger))) return false;
  if (when.triggersAny && !when.triggersAny.some((trigger) => triggers.has(trigger))) return false;
  return true;
}

function resolveInside(root, path, label) {
  if (isAbsolute(path)) throw new Error(`${label} must be relative to the repository root: ${path}`);
  const absolutePath = resolve(root, path);
  const relativePath = relative(root, absolutePath);
  if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new Error(`${label} escapes the repository root: ${path}`);
  }
  return absolutePath;
}

function renderContent(selection, fragments) {
  const lines = [
    "# Effective Instruction Bundle",
    "",
    `Context: stack=${selection.stack}; request_type=${selection.requestType}; phase=${selection.phase}; triggers=${selection.triggers.join(",") || "none"}`,
    "",
  ];

  fragments.forEach((fragment) => {
    lines.push(`## ${fragment.policyId}`, "", fragment.content.trimEnd(), "");
  });

  return `${lines.join("\n").trimEnd()}\n`;
}

export function compileInstructionBundle(repoRoot, manifestPath, inputSelection) {
  const root = resolve(repoRoot);
  const absoluteManifestPath = resolveInside(root, manifestPath, "Manifest path");
  const manifestSource = readFileSync(absoluteManifestPath, "utf8");
  const manifest = readJson(absoluteManifestPath, "instruction manifest");
  const layers = assertManifest(manifest);
  const selection = normalizeSelection(inputSelection, manifest.supported);

  const selected = manifest.fragments
    .map((fragment, index) => ({ ...fragment, index }))
    .filter((fragment) => matches(fragment.when, selection))
    .map((fragment) => {
      const absolutePath = resolveInside(root, fragment.path, `Fragment ${fragment.id} path`);
      if (!existsSync(absolutePath)) throw new Error(`Missing fragment ${fragment.id}: ${fragment.path}`);
      const content = readFileSync(absolutePath, "utf8");
      if (content.trim().length === 0) throw new Error(`Fragment ${fragment.id} is empty: ${fragment.path}`);
      return {
        ...fragment,
        precedence: layers.get(fragment.layer),
        content,
        sourceHash: sha256(content),
      };
    })
    .sort((left, right) => left.precedence - right.precedence || left.index - right.index);

  const winners = new Map();
  for (const fragment of selected) {
    const current = winners.get(fragment.policyId);
    if (!current) {
      winners.set(fragment.policyId, fragment);
      continue;
    }
    if (fragment.precedence <= current.precedence) {
      throw new Error(
        `Conflicting policy ${fragment.policyId} must have strictly increasing precedence: ${current.id} -> ${fragment.id}`,
      );
    }
    if (!(fragment.overrides ?? []).includes(current.id)) {
      throw new Error(
        `${fragment.id} must explicitly override ${current.id} for policy ${fragment.policyId}`,
      );
    }
    if (current.protected) {
      throw new Error(`${fragment.id} cannot override protected policy ${fragment.policyId} from ${current.id}`);
    }
    winners.set(fragment.policyId, fragment);
  }

  const effectiveFragments = [...winners.values()].sort(
    (left, right) => left.precedence - right.precedence || left.index - right.index,
  );
  const effectivePolicyIds = new Set(effectiveFragments.map(({ policyId }) => policyId));
  const activeRequirements = manifest.requirements.filter((requirement) =>
    matches(requirement.when, selection),
  );
  const missing = activeRequirements.flatMap((requirement) =>
    requirement.policyIds
      .filter((policyId) => !effectivePolicyIds.has(policyId))
      .map((policyId) => `${requirement.id}:${policyId}`),
  );
  if (missing.length > 0) {
    throw new Error(`Instruction omission check failed: ${missing.join(", ")}`);
  }

  const content = renderContent(selection, effectiveFragments);
  const metadata = {
    schemaVersion: 1,
    compilerId: manifest.compilerId,
    selection,
    precedence: manifest.layers.map(({ id, precedence }) => ({ id, precedence })),
    manifestHash: sha256(manifestSource),
    contentHash: sha256(content),
    fragments: effectiveFragments.map((fragment) => ({
      id: fragment.id,
      policyId: fragment.policyId,
      layer: fragment.layer,
      precedence: fragment.precedence,
      path: fragment.path,
      sourceHash: fragment.sourceHash,
      protected: fragment.protected === true,
      overrides: fragment.overrides ?? [],
    })),
    omissionCheck: {
      status: "passing",
      requirementIds: activeRequirements.map(({ id }) => id),
      requiredPolicyIds: [...new Set(activeRequirements.flatMap(({ policyIds }) => policyIds))].sort(),
    },
  };

  const bundle = { metadata, content };
  assertEffectiveInstructionBundle(bundle);
  return bundle;
}

export function assertEffectiveInstructionBundle(bundle) {
  if (bundle?.metadata?.schemaVersion !== 1) throw new Error("Bundle schemaVersion must be 1");
  assertNonEmptyString(bundle?.metadata?.compilerId, "Bundle compilerId");
  assertNonEmptyString(bundle?.content, "Bundle content");
  if (bundle.metadata.contentHash !== sha256(bundle.content)) {
    throw new Error("Bundle contentHash does not match flattened content");
  }
  if (!Array.isArray(bundle.metadata.fragments) || bundle.metadata.fragments.length === 0) {
    throw new Error("Bundle must contain selected fragments");
  }
  bundle.metadata.fragments.forEach((fragment) => {
    if (!/^[a-f0-9]{64}$/.test(fragment.sourceHash ?? "")) {
      throw new Error(`Bundle fragment ${fragment.id ?? "<missing>"} has an invalid sourceHash`);
    }
  });
  if (bundle.metadata.omissionCheck?.status !== "passing") {
    throw new Error("Bundle omission check is not passing");
  }
  return true;
}

export function serializeInstructionBundle(bundle) {
  assertEffectiveInstructionBundle(bundle);
  return `<!-- effective-instruction-bundle ${JSON.stringify(bundle.metadata)} -->\n${bundle.content}`;
}

function atomicWrite(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  const temporaryPath = resolve(dirname(path), `.${randomUUID()}.instruction-bundle.tmp`);
  writeFileSync(temporaryPath, content);
  renameSync(temporaryPath, path);
}

function usage() {
  return [
    "Usage:",
    "  instruction-compiler.mjs compile --repo-root <path> --manifest <path> --stack <id> --request-type <feature|bug> --phase <id> [--trigger <id> ...] --output <path>",
    "  instruction-compiler.mjs check --repo-root <path> --manifest <path> --stack <id> --request-type <feature|bug> --phase <id> [--trigger <id> ...] --golden <path>",
  ].join("\n");
}

function parseArgs(argv) {
  const command = argv[0];
  if (!command || command === "--help" || command === "-h") return { help: true };
  if (!["compile", "check"].includes(command)) throw new Error(`Unknown command: ${command}`);

  const options = { command, triggers: [] };
  const keys = {
    "--repo-root": "repoRoot",
    "--manifest": "manifest",
    "--stack": "stack",
    "--request-type": "requestType",
    "--phase": "phase",
    "--output": "output",
    "--golden": "golden",
  };
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--trigger") {
      if (index + 1 >= argv.length) throw new Error("Missing value for --trigger");
      options.triggers.push(argv[index + 1]);
      index += 1;
      continue;
    }
    const key = keys[arg];
    if (!key || index + 1 >= argv.length) throw new Error(`Unknown option or missing value: ${arg}`);
    options[key] = argv[index + 1];
    index += 1;
  }

  for (const key of ["repoRoot", "manifest", "stack", "requestType", "phase"]) {
    if (!options[key]) throw new Error(`Missing required option: ${key}`);
  }
  if (command === "compile" && !options.output) throw new Error("compile requires --output");
  if (command === "check" && !options.golden) throw new Error("check requires --golden");
  return options;
}

export function runInstructionCompilerCli(argv = process.argv.slice(2)) {
  try {
    const options = parseArgs(argv);
    if (options.help) {
      console.log(usage());
      return;
    }
    const bundle = compileInstructionBundle(options.repoRoot, options.manifest, {
      stack: options.stack,
      requestType: options.requestType,
      phase: options.phase,
      triggers: options.triggers,
    });
    const serialized = serializeInstructionBundle(bundle);

    if (options.command === "compile") {
      const outputPath = resolve(options.output);
      atomicWrite(outputPath, serialized);
      console.log(`Wrote effective instruction bundle: ${outputPath}`);
      console.log(`content_sha256\t${bundle.metadata.contentHash}`);
      return;
    }

    const goldenPath = resolve(options.golden);
    if (!existsSync(goldenPath)) throw new Error(`Missing golden effective-policy snapshot: ${goldenPath}`);
    if (readFileSync(goldenPath, "utf8") !== serialized) {
      throw new Error(`Golden effective-policy snapshot differs: ${goldenPath}`);
    }
    console.log(`Golden effective-policy snapshot matches: ${goldenPath}`);
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exitCode = 1;
  }
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  runInstructionCompilerCli();
}
