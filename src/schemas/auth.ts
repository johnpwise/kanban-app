import { z } from "zod";

export const emailSchema = z.string().trim().email("Enter a valid email address.");

export const passwordSchema = z.string().min(8, "Password must be at least 8 characters long.");

export const idTokenSchema = z.string().min(1, "Missing ID token.");
