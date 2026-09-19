"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createProject } from "@/lib/services/projects";
import { projectNameSchema } from "@/schemas/project";

export interface CreateProjectActionState {
  status: "idle" | "error";
  message?: string;
}

export async function createProjectAction(
  _previousState: CreateProjectActionState,
  formData: FormData,
): Promise<CreateProjectActionState> {
  const parsed = projectNameSchema.safeParse(formData.get("name"));

  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Enter a valid project name.",
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
