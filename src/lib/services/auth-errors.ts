export const AUTH_ERROR_CODES = [
  "invalid_credentials",
  "user_already_exists",
  "email_not_confirmed",
  "weak_password",
  "invalid_input",
  "unavailable",
  "no_profile",
  "link_expired",
  "rate_limited",
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
  rate_limited: "Za dużo prób. Spróbuj ponownie za kilka minut.",
  link_expired: "Link wygasł lub został już użyty. Jeśli e-mail jest już potwierdzony, zaloguj się.",
  unknown: "Coś poszło nie tak. Spróbuj ponownie.",
};

function isAuthErrorCode(value: string): value is AuthErrorCode {
  return (AUTH_ERROR_CODES as readonly string[]).includes(value);
}

/** Supabase codes that have no code of their own in the closed set. */
const SUPABASE_CODE_ALIASES: Partial<Record<string, AuthErrorCode>> = {
  over_email_send_rate_limit: "rate_limited",
  over_request_rate_limit: "rate_limited",
};

/** Endpoint side: maps a Supabase auth error to a code from the closed set (keyed by the stable `code`). */
export function toAuthErrorCode(error: { code?: string }): AuthErrorCode {
  if (!error.code) return "unknown";
  if (isAuthErrorCode(error.code)) return error.code;
  return SUPABASE_CODE_ALIASES[error.code] ?? "unknown";
}

/** Page side: maps a `?error=` value to a Polish message. Arbitrary URL text never reaches the UI. */
export function authErrorMessage(code: string | null): string | null {
  if (code === null) return null;
  return isAuthErrorCode(code) ? AUTH_ERROR_MESSAGES[code] : AUTH_ERROR_MESSAGES.unknown;
}
