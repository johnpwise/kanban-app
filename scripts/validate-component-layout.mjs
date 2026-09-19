import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const componentTestPatterns = [
  { suffix: ".component.test.tsx", componentExtension: ".tsx" },
  { suffix: ".component.test.ts", componentExtension: ".vue" },
];

const allowedUiRoots = new Set(["components", "views", "features", "app"]);

function listFiles(directory) {
  if (!existsSync(directory)) {
    return [];
  }

  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);

    return statSync(path).isDirectory() ? listFiles(path) : [path];
  });
}

function getTestDetails(fileName) {
  return componentTestPatterns.find(({ suffix }) => fileName.endsWith(suffix));
}

function isAllowedLocation(srcDirectory, testPath, componentName) {
  const testDirectory = relative(srcDirectory, testPath).split(sep).slice(0, -1);

  if (testDirectory.length === 0) {
    return componentName === "App";
  }

  return allowedUiRoots.has(testDirectory[0]) && testDirectory.length >= 2;
}

export function validateComponentTestLayout(projectRoot) {
  const srcDirectory = join(projectRoot, "src");
  const failures = [];

  listFiles(srcDirectory).forEach((testPath) => {
    const fileName = testPath.split(sep).at(-1);
    const details = getTestDetails(fileName);

    if (!details) {
      return;
    }

    const componentName = fileName.slice(0, -details.suffix.length);
    const expectedComponentPath = join(testPath, "..", `${componentName}${details.componentExtension}`);
    const displayPath = relative(projectRoot, testPath);

    if (!isAllowedLocation(srcDirectory, testPath, componentName)) {
      failures.push(
        `${displayPath}: component tests must live in a named UI-unit folder under src/components, src/views, src/features, or src/app. Only src/App.component.test.* may live at the src root.`,
      );
    }

    if (!existsSync(expectedComponentPath)) {
      failures.push(
        `${displayPath}: expected sibling component ${relative(projectRoot, expectedComponentPath)}.`,
      );
    }
  });

  return failures;
}

function run() {
  const failures = validateComponentTestLayout(process.cwd());

  if (failures.length > 0) {
    console.error("Component test layout validation failed.");
    failures.forEach((failure) => console.error(`- ${failure}`));
    process.exitCode = 1;
    return;
  }

  console.log("Component test layout validation passed.");
}

if (resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run();
}
