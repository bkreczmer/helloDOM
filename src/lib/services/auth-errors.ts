export const AUTH_ERROR_CODES = [
  "invalid_credentials",
  "user_already_exists",
  "email_not_confirmed",
  "weak_password",
  "invalid_input",
  "unavailable",
  "no_profile",
  "link_expired",
  "unknown",
] as const;

export type AuthErrorCode = (typeof AUTH_ERROR_CODES)[number];

const AUTH_ERROR_MESSAGES: Record<AuthErrorCode, string> = {
  invalid_credentials: "Nieprawidłowy e-mail lub hasło",
  user_already_exists: "Konto z tym adresem e-mail już istnieje",
  email_not_confirmed: "Potwierdź adres e-mail, zanim się zalogujesz",
  weak_password: "Hasło jest za słabe — użyj co najmniej 6 znaków",
  invalid_input: "Sprawdź poprawność danych w formularzu",
  unavailable: "Usługa logowania jest chwilowo niedostępna",
  no_profile: "Twoje konto nie ma przypisanej roli. Skontaktuj się z nami.",
  link_expired: "Link wygasł lub został już użyty. Zaloguj się albo zarejestruj ponownie.",
  unknown: "Coś poszło nie tak. Spróbuj ponownie.",
};

function isAuthErrorCode(value: string): value is AuthErrorCode {
  return (AUTH_ERROR_CODES as readonly string[]).includes(value);
}

/** Endpoint side: maps a Supabase auth error to a code from the closed set (keyed by the stable `code`). */
export function toAuthErrorCode(error: { code?: string }): AuthErrorCode {
  return error.code && isAuthErrorCode(error.code) ? error.code : "unknown";
}

/** Page side: maps a `?error=` value to a Polish message. Arbitrary URL text never reaches the UI. */
export function authErrorMessage(code: string | null): string | null {
  if (code === null) return null;
  return isAuthErrorCode(code) ? AUTH_ERROR_MESSAGES[code] : AUTH_ERROR_MESSAGES.unknown;
}
