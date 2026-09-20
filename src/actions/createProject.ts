"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createProject } from "@/lib/services/projects";
import { getCurrentUser } from "@/lib/services/session";
import { createProjectRequestSchema } from "@/schemas/project";

export interface CreateProjectActionState {
  status: "idle" | "error";
  message?: string;
}

export async function createProjectAction(
  _previousState: CreateProjectActionState,
  formData: FormData,
): Promise<CreateProjectActionState> {
  const user = await getCurrentUser();

  if (!user) {
    return { status: "error", message: "You must be signed in to create a project." };
  }

  const parsed = createProjectRequestSchema.safeParse({
    name: formData.get("name"),
    repository: formData.get("repository"),
    defaultBranch: formData.get("defaultBranch"),
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Enter valid project details.",
    };
  }

  let project;

  try {
    project = await createProject(parsed.data);
  } catch (error) {
    console.error("Failed to create project.", error);
    return {
      status: "error",
      message: "Could not create the project. Please try again.",
    };
  }

  revalidatePath("/");
  redirect(`/projects/${project.id}`);
}
