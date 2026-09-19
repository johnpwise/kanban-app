"use server";

import { subscribeEmail } from "@/lib/services/subscriptions";
import { subscribeRequestSchema } from "@/schemas/subscribe";

export interface SubscribeActionState {
  status: "idle" | "success" | "error";
  message?: string;
}

export async function subscribeAction(
  _previousState: SubscribeActionState,
  formData: FormData,
): Promise<SubscribeActionState> {
  const parsed = subscribeRequestSchema.safeParse({
    email: formData.get("email"),
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Enter a valid email address.",
    };
  }

  await subscribeEmail(parsed.data);

  return { status: "success", message: "Subscribed." };
}
