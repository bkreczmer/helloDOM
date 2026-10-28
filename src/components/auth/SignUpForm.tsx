import React, { useState } from "react";
import { Mail, Lock, UserPlus } from "lucide-react";
import { FormField } from "@/components/auth/FormField";
import { RoleChoice } from "@/components/auth/RoleChoice";
import { PasswordToggle } from "@/components/auth/PasswordToggle";
import { SubmitButton } from "@/components/auth/SubmitButton";
import { ServerError } from "@/components/auth/ServerError";
import { useNativeSubmitting } from "@/components/hooks/useNativeSubmitting";
import type { Role } from "@/types";

const MIN_PASSWORD_LENGTH = 6;

function formatMissingChars(count: number) {
  const lastDigit = count % 10;
  const lastTwo = count % 100;
  const noun =
    count === 1 ? "znak" : lastDigit >= 2 && lastDigit <= 4 && (lastTwo < 12 || lastTwo > 14) ? "znaki" : "znaków";
  return `Brakuje jeszcze ${count} ${noun}`;
}

interface Props {
  serverError?: string | null;
}

export default function SignUpForm({ serverError }: Props) {
  const [role, setRole] = useState<Role | "">("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [errors, setErrors] = useState<{ role?: string; email?: string; password?: string; confirmPassword?: string }>(
    {},
  );
  const [submitting, setSubmitting] = useNativeSubmitting();

  function validate() {
    const next: typeof errors = {};

    if (!role) {
      next.role = "Wybierz, czy jesteś właścicielem, czy agentem";
    }

    if (!email.trim()) {
      next.email = "Podaj adres e-mail";
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      next.email = "Podaj poprawny adres e-mail";
    }

    if (!password) {
      next.password = "Podaj hasło";
    } else if (password.length < MIN_PASSWORD_LENGTH) {
      next.password = `Hasło musi mieć co najmniej ${MIN_PASSWORD_LENGTH} znaków`;
    }

    if (!confirmPassword) {
      next.confirmPassword = "Powtórz hasło";
    } else if (password !== confirmPassword) {
      next.confirmPassword = "Hasła nie są takie same";
    }

    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function clearError(field: keyof typeof errors) {
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: undefined }));
  }

  function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    if (!validate()) {
      e.preventDefault();
      // Move focus to the first invalid field so screen readers announce the error.
      const form = e.currentTarget;
      requestAnimationFrame(() => {
        form.querySelector<HTMLInputElement>('[aria-invalid="true"]')?.focus();
      });
      return;
    }
    setSubmitting(true);
  }

  const passwordHint =
    !errors.password && password.length > 0 && password.length < MIN_PASSWORD_LENGTH ? (
      <p className="text-rs-fg-3 mt-1 text-[11.5px]">{formatMissingChars(MIN_PASSWORD_LENGTH - password.length)}</p>
    ) : undefined;

  return (
    <form method="POST" action="/api/auth/signup" className="space-y-4" onSubmit={handleSubmit} noValidate>
      <RoleChoice
        value={role}
        onChange={(r) => {
          setRole(r);
          clearError("role");
        }}
        error={errors.role}
      />

      <FormField
        id="email"
        autoComplete="email"
        type="email"
        label="E-mail"
        value={email}
        onChange={(v) => {
          setEmail(v);
          clearError("email");
        }}
        placeholder="ty@przyklad.pl"
        error={errors.email}
        icon={<Mail className="size-4" />}
      />

      <FormField
        id="password"
        autoComplete="new-password"
        label="Hasło"
        type={showPassword ? "text" : "password"}
        value={password}
        onChange={(v) => {
          setPassword(v);
          clearError("password");
        }}
        placeholder="Co najmniej 6 znaków"
        error={errors.password}
        hint={passwordHint}
        icon={<Lock className="size-4" />}
        endContent={
          <PasswordToggle
            visible={showPassword}
            onToggle={() => {
              setShowPassword(!showPassword);
            }}
          />
        }
      />

      <FormField
        id="confirmPassword"
        autoComplete="new-password"
        name="confirmPassword"
        label="Powtórz hasło"
        type={showConfirmPassword ? "text" : "password"}
        value={confirmPassword}
        onChange={(v) => {
          setConfirmPassword(v);
          clearError("confirmPassword");
        }}
        placeholder="Wpisz hasło ponownie"
        error={errors.confirmPassword}
        icon={<Lock className="size-4" />}
        endContent={
          <PasswordToggle
            visible={showConfirmPassword}
            onToggle={() => {
              setShowConfirmPassword(!showConfirmPassword);
            }}
          />
        }
      />

      <ServerError message={serverError} />

      <SubmitButton pending={submitting} pendingText="Zakładanie konta…" icon={<UserPlus className="size-4" />}>
        Załóż konto
      </SubmitButton>
    </form>
  );
}
