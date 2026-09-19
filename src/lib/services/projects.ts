import "server-only";

import { getFirebaseFirestore } from "@/lib/firebase/admin";
import {
  createProject as createProjectInRepository,
  getProject as getProjectFromRepository,
  listProjects as listProjectsFromRepository,
} from "@/lib/repositories/firestoreBoardRepository";

export async function listProjects() {
  return listProjectsFromRepository(getFirebaseFirestore());
}

export async function createProject(name: string) {
  return createProjectInRepository(getFirebaseFirestore(), name);
}

export async function getProject(projectId: string) {
  return getProjectFromRepository(getFirebaseFirestore(), projectId);
}
