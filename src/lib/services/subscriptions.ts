import type { SubscribeRequest } from "@/schemas/subscribe";

export async function subscribeEmail(request: SubscribeRequest): Promise<void> {
  console.log(`Subscribed: ${request.email}`);
}
