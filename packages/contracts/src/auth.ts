import { z } from "zod";

export const AUTH_SESSION_COOKIE_NAME = "lps_session";

export const normalizedEmailSchema = z
  .string()
  .trim()
  .email()
  .max(254)
  .transform((value) => value.toLowerCase());

export const passwordSchema = z.string().min(12).max(128);

export const registerRequestSchema = z
  .object({
    email: normalizedEmailSchema,
    password: passwordSchema,
    displayName: z.string().trim().min(1).max(80),
  })
  .strict();

export const loginRequestSchema = z
  .object({
    email: normalizedEmailSchema,
    password: z.string().min(1).max(128),
  })
  .strict();

export const authUserSchema = z.object({
  userId: z.string().uuid(),
  email: normalizedEmailSchema,
  displayName: z.string().min(1).max(80),
});

export const authSessionResponseSchema = z.object({
  data: z.object({
    user: authUserSchema,
    expiresAt: z.string().datetime(),
  }),
});

export const logoutResponseSchema = z.object({
  data: z.object({ signedOut: z.literal(true) }),
});

export type RegisterRequest = z.infer<typeof registerRequestSchema>;
export type LoginRequest = z.infer<typeof loginRequestSchema>;
export type AuthUser = z.infer<typeof authUserSchema>;
export type AuthSessionResponse = z.infer<typeof authSessionResponseSchema>;
