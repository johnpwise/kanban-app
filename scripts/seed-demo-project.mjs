import process from "node:process";

import { applicationDefault, deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

const projectArgument = process.argv.find((argument) => argument.startsWith("--project="));
const projectId = projectArgument?.slice("--project=".length);
const confirmedLiveWrite = process.argv.includes("--confirm-live");

if (!projectId) {
  throw new Error("Pass the target explicitly with --project=<firebase-project-id>.");
}

if (!projectId.startsWith("demo-") && !confirmedLiveWrite) {
  throw new Error("Live seeding requires the explicit --confirm-live flag.");
}

const app = initializeApp({ credential: applicationDefault(), projectId }, `demo-seed-${Date.now()}`);
const firestore = getFirestore(app);
const projects = firestore.collection("projects");
const reference = projects.doc();

const columns = [
  { id: "todo", title: "To Do", position: 0, cardIds: ["card-1", "card-2"] },
  { id: "in-progress", title: "In Progress", position: 1, cardIds: ["card-3"] },
  { id: "done", title: "Done", position: 2, cardIds: [] },
];
const cards = [
  { id: "card-1", title: "Design the board schema", label: "feature", createdAt: "2026-01-05T09:00:00.000Z" },
  { id: "card-2", title: "Fix the drag ghost image", label: "bug", createdAt: "2026-01-06T09:00:00.000Z" },
  { id: "card-3", title: "Wire up CI", label: "chore", createdAt: "2026-01-07T09:00:00.000Z" },
];

try {
  const seededProject = await firestore.runTransaction(async (transaction) => {
    const existing = await transaction.get(projects.where("name", "==", "Demo Project").limit(1));

    if (!existing.empty) {
      return existing.docs[0].ref;
    }

    transaction.create(reference, { name: "Demo Project", createdAt: Timestamp.now() });

    for (const column of columns) {
      transaction.create(reference.collection("columns").doc(column.id), {
        title: column.title,
        position: column.position,
        cardIds: column.cardIds,
      });
    }

    for (const card of cards) {
      transaction.create(reference.collection("cards").doc(card.id), {
        title: card.title,
        label: card.label,
        createdAt: Timestamp.fromDate(new Date(card.createdAt)),
        notes: null,
        dueDate: null,
      });
    }

    return reference;
  });

  const [projectSnapshot, columnsSnapshot, cardsSnapshot] = await Promise.all([
    seededProject.get(),
    seededProject.collection("columns").get(),
    seededProject.collection("cards").get(),
  ]);

  console.log(JSON.stringify({
    projectId: seededProject.id,
    name: projectSnapshot.get("name"),
    columns: columnsSnapshot.size,
    cards: cardsSnapshot.size,
  }));
} finally {
  await deleteApp(app);
}
