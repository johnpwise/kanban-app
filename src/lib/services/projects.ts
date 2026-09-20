import "server-only";

import { getFirebaseFirestore } from "@/lib/firebase/admin";
import {
  createProject as createProjectInRepository,
  getProject as getProjectFromRepository,
  listProjects as listProjectsFromRepository,
} from "@/lib/repositories/firestoreBoardRepository";

import type { CreateProjectRequest } from "@/schemas/project";

export async function listProjects() {
  return listProjectsFromRepository(getFirebaseFirestore());
}

export async function createProject(input: CreateProjectRequest) {
  return createProjectInRepository(getFirebaseFirestore(), input);
}

export async function getProject(projectId: string) {
  return getProjectFromRepository(getFirebaseFirestore(), projectId);
}
