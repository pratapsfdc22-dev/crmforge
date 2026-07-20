import { z } from "zod";

export const UserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string().optional(),
  createdAt: z.date(),
});

export type User = z.infer<typeof UserSchema>;

export const TeamSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  ownerId: z.string().uuid(),
  createdAt: z.date(),
});

export type Team = z.infer<typeof TeamSchema>;
