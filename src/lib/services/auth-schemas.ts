import { z } from "astro/zod";
import { ROLES } from "@/types";

// Keep in sync with MIN_PASSWORD_LENGTH in src/components/auth/SignUpForm.tsx.
const MIN_PASSWORD_LENGTH = 6;

const email = z.string().trim().pipe(z.email());

export const signInSchema = z.object({
  email,
  password: z.string().min(1),
});

// confirmPassword is validated on the client only.
export const signUpSchema = z.object({
  email,
  password: z.string().min(MIN_PASSWORD_LENGTH),
  role: z.enum(ROLES),
});
