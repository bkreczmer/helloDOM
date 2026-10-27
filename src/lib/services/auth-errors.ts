const AUTH_ERROR_MESSAGES: Record<string, string> = {
  invalid_credentials: "Nieprawidłowy e-mail lub hasło",
  user_already_exists: "Konto z tym adresem e-mail już istnieje",
  email_not_confirmed: "Potwierdź adres e-mail, zanim się zalogujesz",
  weak_password: "Hasło jest za słabe — użyj co najmniej 6 znaków",
};

const FALLBACK_MESSAGE = "Coś poszło nie tak. Spróbuj ponownie.";

export const AUTH_UNAVAILABLE_MESSAGE = "Usługa logowania jest chwilowo niedostępna";

/** Maps a Supabase auth error to a Polish, user-facing message (keyed by the stable `code`). */
export function toPolishAuthError(error: { code?: string; message: string }): string {
  return (error.code ? AUTH_ERROR_MESSAGES[error.code] : undefined) ?? FALLBACK_MESSAGE;
}
