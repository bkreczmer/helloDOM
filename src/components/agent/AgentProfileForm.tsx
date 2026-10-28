import React, { useState } from "react";
import { Banknote, Briefcase, CircleAlert, CircleCheck, Save } from "lucide-react";
import { ChoiceChips } from "@/components/agent/ChoiceChips";
import { FormField } from "@/components/auth/FormField";
import { SubmitButton } from "@/components/auth/SubmitButton";
import { ServerError } from "@/components/auth/ServerError";
import { useNativeSubmitting } from "@/components/hooks/useNativeSubmitting";
import { CITIES, CITY_LABELS, PROPERTY_TYPES, PROPERTY_TYPE_LABELS } from "@/lib/dictionaries";
import type { MissingProfileField } from "@/lib/services/agent-profile";
import { cn } from "@/lib/utils";
import type { AgentProfile, City, PropertyType } from "@/types";

const CITY_OPTIONS = CITIES.map((value) => ({ value, label: CITY_LABELS[value] }));
const PROPERTY_TYPE_OPTIONS = PROPERTY_TYPES.map((value) => ({ value, label: PROPERTY_TYPE_LABELS[value] }));

const MISSING_LABELS: Record<MissingProfileField, string> = {
  cities: "miasta",
  propertyTypes: "typy nieruchomości",
  price: "przedział cen",
  experience: "lata doświadczenia",
};

type NumberField = "priceMin" | "priceMax" | "experienceYears";

interface Props {
  initial: AgentProfile;
  missing: MissingProfileField[];
  /** Server-side upper bounds (agent-profile service), passed in so the island does not bundle the zod schema. */
  limits: { maxPrice: number; maxExperienceYears: number };
  serverError?: string | null;
  saved?: boolean;
}

const toText = (value: number | null) => (value === null ? "" : String(value));

/** Same rule as the server schema: blank means "not set", otherwise digits only. */
function parseWholeNumber(raw: string): number | null | "invalid" {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  if (!/^\d+$/.test(trimmed)) return "invalid";
  return Number(trimmed);
}

export default function AgentProfileForm({ initial, missing, limits, serverError, saved }: Props) {
  const [cities, setCities] = useState<City[]>(initial.cities);
  const [propertyTypes, setPropertyTypes] = useState<PropertyType[]>(initial.propertyTypes);
  const [priceMin, setPriceMin] = useState(toText(initial.priceMin));
  const [priceMax, setPriceMax] = useState(toText(initial.priceMax));
  const [experienceYears, setExperienceYears] = useState(toText(initial.experienceYears));
  const [errors, setErrors] = useState<Partial<Record<NumberField, string>>>({});
  const [submitting, setSubmitting] = useNativeSubmitting();

  function validate() {
    const next: typeof errors = {};

    const min = parseWholeNumber(priceMin);
    const max = parseWholeNumber(priceMax);
    for (const [field, parsed] of [
      ["priceMin", min],
      ["priceMax", max],
    ] as const) {
      if (parsed === "invalid") {
        next[field] = "Podaj kwotę w pełnych złotych, same cyfry";
      } else if (parsed !== null && parsed > limits.maxPrice) {
        next[field] = "Kwota jest zbyt duża";
      }
    }
    if (!next.priceMin && !next.priceMax && typeof min === "number" && typeof max === "number" && min > max) {
      next.priceMax = "Cena maksymalna nie może być niższa od minimalnej";
    }

    const years = parseWholeNumber(experienceYears);
    if (years === "invalid" || (years !== null && years > limits.maxExperienceYears)) {
      next.experienceYears = `Podaj liczbę lat od 0 do ${limits.maxExperienceYears}`;
    }

    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function clearError(field: NumberField) {
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

  return (
    <div className="flex flex-col gap-4">
      {saved && (
        <p
          role="status"
          className="rounded-control bg-rs-success-soft text-rs-success-fg flex items-center gap-2 border border-[color-mix(in_oklab,var(--rs-success)_30%,transparent)] px-3 py-2 text-[13px] font-semibold"
        >
          <CircleCheck className="size-4 shrink-0" aria-hidden="true" />
          Zapisano profil
        </p>
      )}

      {initial.complete ? (
        <p className="rounded-control bg-rs-success-soft text-rs-success-fg flex items-start gap-2 px-3 py-2 text-[13px]">
          <CircleCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>
            <span className="font-semibold">Profil pełny</span> — pojawiasz się w rankingu
          </span>
        </p>
      ) : (
        <p className="rounded-control bg-rs-warn-soft text-rs-warn-fg flex items-start gap-2 px-3 py-2 text-[13px]">
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>
            <span className="font-semibold">Profil niepełny</span> — nie pojawiasz się w rankingu.
            {missing.length > 0 && <> Brakuje: {missing.map((field) => MISSING_LABELS[field]).join(", ")}.</>}
          </span>
        </p>
      )}

      <form
        method="POST"
        action="/api/agent/profile"
        className="flex flex-col gap-5"
        onSubmit={handleSubmit}
        noValidate
      >
        {/* inert, not disabled: disabled controls would drop out of the natively submitted form data. */}
        <div
          inert={submitting}
          aria-busy={submitting || undefined}
          className={cn("flex flex-col gap-5 transition-opacity duration-[180ms]", submitting && "opacity-60")}
        >
          <ChoiceChips
            id="cities"
            name="cities"
            legend="Miasta"
            hint="Zaznacz miasta, w których działasz."
            options={CITY_OPTIONS}
            value={cities}
            onChange={setCities}
          />

          <ChoiceChips
            id="propertyTypes"
            name="propertyTypes"
            legend="Typy nieruchomości"
            options={PROPERTY_TYPE_OPTIONS}
            value={propertyTypes}
            onChange={setPropertyTypes}
          />

          <fieldset className="min-w-0">
            <legend className="text-rs-fg-2 mb-1 block text-[11.5px] font-semibold">Przedział cen (PLN)</legend>
            <div className="tablet:grid-cols-2 grid grid-cols-1 gap-3">
              <FormField
                id="priceMin"
                label="Od"
                inputMode="numeric"
                autoComplete="off"
                value={priceMin}
                onChange={(v) => {
                  setPriceMin(v);
                  clearError("priceMin");
                }}
                placeholder="np. 300000"
                error={errors.priceMin}
                icon={<Banknote className="size-4" />}
              />
              <FormField
                id="priceMax"
                label="Do"
                inputMode="numeric"
                autoComplete="off"
                value={priceMax}
                onChange={(v) => {
                  setPriceMax(v);
                  clearError("priceMax");
                }}
                placeholder="np. 900000"
                error={errors.priceMax}
                icon={<Banknote className="size-4" />}
              />
            </div>
          </fieldset>

          <FormField
            id="experienceYears"
            label="Lata doświadczenia"
            inputMode="numeric"
            autoComplete="off"
            value={experienceYears}
            onChange={(v) => {
              setExperienceYears(v);
              clearError("experienceYears");
            }}
            placeholder={`0–${limits.maxExperienceYears}`}
            error={errors.experienceYears}
            icon={<Briefcase className="size-4" />}
          />
        </div>

        <ServerError message={serverError} />

        <SubmitButton pending={submitting} pendingText="Zapisywanie…" icon={<Save className="size-4" />}>
          Zapisz profil
        </SubmitButton>
      </form>
    </div>
  );
}
