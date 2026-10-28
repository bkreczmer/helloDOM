// Return values of public.delete_own_account in supabase/migrations/20261028220000_account_deletion.sql;
// keep both lists in sync.
export const DELETE_ACCOUNT_RESULTS = ["ok", "not_found"] as const;

export type DeleteAccountResult = (typeof DELETE_ACCOUNT_RESULTS)[number];

export function isDeleteAccountResult(value: unknown): value is DeleteAccountResult {
  return typeof value === "string" && (DELETE_ACCOUNT_RESULTS as readonly string[]).includes(value);
}

export const ACCOUNT_ERROR_CODES = ["unavailable", "unknown"] as const;

export type AccountErrorCode = (typeof ACCOUNT_ERROR_CODES)[number];

const ACCOUNT_ERROR_MESSAGES: Record<AccountErrorCode, string> = {
  unavailable: "Usuwanie konta jest chwilowo niedostępne. Spróbuj ponownie za chwilę.",
  unknown: "Nie udało się usunąć konta. Spróbuj ponownie.",
};

function isAccountErrorCode(value: string): value is AccountErrorCode {
  return (ACCOUNT_ERROR_CODES as readonly string[]).includes(value);
}

/** Account pages: maps a `?error=` value to a Polish message. Arbitrary URL text never reaches the UI. */
export function accountErrorMessage(code: string | null): string | null {
  if (code === null) return null;
  return isAccountErrorCode(code) ? ACCOUNT_ERROR_MESSAGES[code] : ACCOUNT_ERROR_MESSAGES.unknown;
}
