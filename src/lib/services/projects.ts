import "server-only";

import { firestore } from "@/lib/firebase/admin";
import {
  createProject as createProjectInRepository,
  getProject as getProjectFromRepository,
  listProjects as listProjectsFromRepository,
} from "@/lib/repositories/firestoreBoardRepository";

export async function listProjects() {
  return listProjectsFromRepository(firestore);
}

export async function createProject(name: string) {
  return createProjectInRepository(firestore, name);
}

export async function getProject(projectId: string) {
  return getProjectFromRepository(firestore, projectId);
}
