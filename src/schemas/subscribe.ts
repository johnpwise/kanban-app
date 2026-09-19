import { z } from "zod";

export const subscribeRequestSchema = z.object({
  email: z.string().trim().email("Enter a valid email address."),
});

export type SubscribeRequest = z.infer<typeof subscribeRequestSchema>;
