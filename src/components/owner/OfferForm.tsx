import React, { useState } from "react";
import type { ReactNode } from "react";
import {
  Banknote,
  Building2,
  ChevronDown,
  CircleAlert,
  DoorOpen,
  HandCoins,
  House,
  KeyRound,
  LandPlot,
  MapPin,
  Ruler,
  Save,
} from "lucide-react";
import { FormField } from "@/components/auth/FormField";
import { SubmitButton } from "@/components/auth/SubmitButton";
import { ServerError } from "@/components/auth/ServerError";
import { ChoiceCards } from "@/components/owner/ChoiceCards";
import { useNativeSubmitting } from "@/components/hooks/useNativeSubmitting";
import {
  CITIES,
  CITY_LABELS,
  PROPERTY_TYPES,
  PROPERTY_TYPE_LABELS,
  TRANSACTIONS,
  TRANSACTION_LABELS,
} from "@/lib/dictionaries";
import { cn } from "@/lib/utils";
import type { City, PropertyType, Transaction } from "@/types";

const PROPERTY_TYPE_ICONS: Record<PropertyType, ReactNode> = {
  apartment: <Building2 className="size-4" />,
  house: <House className="size-4" />,
  plot: <LandPlot className="size-4" />,
};
const TRANSACTION_ICONS: Record<Transaction, ReactNode> = {
  sale: <HandCoins className="size-4" />,
  rent: <KeyRound className="size-4" />,
};

const PROPERTY_TYPE_OPTIONS = PROPERTY_TYPES.map((value) => ({
  value,
  label: PROPERTY_TYPE_LABELS[value],
  icon: PROPERTY_TYPE_ICONS[value],
}));
const TRANSACTION_OPTIONS = TRANSACTIONS.map((value) => ({
  value,
  label: TRANSACTION_LABELS[value],
  icon: TRANSACTION_ICONS[value],
}));

// Same look and states as the input in FormField (no Select/Textarea in src/components/ui).
const controlBase =
  "w-full rounded-control border border-rs-input-border bg-rs-input-bg font-body text-[13.5px] font-medium text-rs-fg transition-[border-color,box-shadow] duration-[180ms] ease-rs placeholder:text-rs-fg-3 hover:not-focus:not-data-[state=error]:border-rs-fg-3 focus:border-rs-focus-border focus:shadow-focus focus:outline-none data-[state=error]:border-rs-danger";

// Same format as AREA_M2_PATTERN in the offers service: up to 5 digits, optional 1–2 decimals after a dot or comma.
const AREA_M2_PATTERN = /^\d{1,5}([.,]\d{1,2})?$/;

type Field = "city" | "propertyType" | "transaction" | "price" | "areaM2" | "rooms" | "description";

interface Props {
  /** Server-side limits (offers service), passed in so the island does not bundle the zod schema. */
  limits: { maxPrice: number; minRooms: number; maxRooms: number; maxDescriptionLength: number };
  serverError?: string | null;
}

/** Counts like the server (code points, CRLF as one line break), so the counter matches what is stored. */
const countChars = (text: string) => Array.from(text.trim().replace(/\r\n?/g, "\n")).length;

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="text-rs-danger-fg mt-1 flex items-center gap-1 text-[11.5px]">
      <CircleAlert className="size-3" />
      {message}
    </p>
  );
}

export default function OfferForm({ limits, serverError }: Props) {
  const [city, setCity] = useState<City | "">("");
  const [propertyType, setPropertyType] = useState<PropertyType | "">("");
  const [transaction, setTransaction] = useState<Transaction | "">("");
  const [price, setPrice] = useState("");
  const [areaM2, setAreaM2] = useState("");
  const [rooms, setRooms] = useState("");
  const [description, setDescription] = useState("");
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [submitting, setSubmitting] = useNativeSubmitting();

  const descriptionLength = countChars(description);
  const descriptionTooLong = descriptionLength > limits.maxDescriptionLength;

  function validate() {
    const next: typeof errors = {};

    if (!city) next.city = "Wybierz miasto";
    if (!propertyType) next.propertyType = "Wybierz typ nieruchomości";
    if (!transaction) next.transaction = "Wybierz rodzaj transakcji";

    const priceText = price.trim();
    if (priceText === "") {
      next.price = "Podaj cenę";
    } else if (!/^\d+$/.test(priceText)) {
      next.price = "Podaj kwotę w pełnych złotych, same cyfry";
    } else if (Number(priceText) < 1) {
      next.price = "Cena musi być większa od zera";
    } else if (Number(priceText) > limits.maxPrice) {
      next.price = "Kwota jest zbyt duża";
    }

    const areaText = areaM2.trim();
    if (areaText !== "") {
      if (!AREA_M2_PATTERN.test(areaText)) {
        next.areaM2 = "Podaj metraż liczbą, np. 54 lub 54,5";
      } else if (Number(areaText.replace(",", ".")) <= 0) {
        next.areaM2 = "Metraż musi być większy od zera";
      }
    }

    const roomsText = rooms.trim();
    if (
      roomsText !== "" &&
      (!/^\d+$/.test(roomsText) || Number(roomsText) < limits.minRooms || Number(roomsText) > limits.maxRooms)
    ) {
      next.rooms = `Podaj liczbę pokoi od ${limits.minRooms} do ${limits.maxRooms}`;
    }

    if (descriptionTooLong) {
      next.description = `Opis może mieć najwyżej ${limits.maxDescriptionLength} znaków`;
    }

    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function clearError(field: Field) {
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: undefined }));
  }

  function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    if (!validate()) {
      e.preventDefault();
      // Move focus to the first invalid field so screen readers announce the error.
      const form = e.currentTarget;
      requestAnimationFrame(() => {
        form.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
      });
      return;
    }
    setSubmitting(true);
  }

  return (
    <form method="POST" action="/api/owner/offers" className="flex flex-col gap-5" onSubmit={handleSubmit} noValidate>
      {/* inert, not disabled: disabled controls would drop out of the natively submitted form data. */}
      <div
        inert={submitting}
        aria-busy={submitting || undefined}
        className={cn("flex flex-col gap-5 transition-opacity duration-[180ms]", submitting && "opacity-60")}
      >
        <div>
          <label htmlFor="city" className="text-rs-fg-2 mb-1 block text-[11.5px] font-semibold">
            Miasto
          </label>
          <div className="relative">
            <span className="text-rs-fg-3 pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2">
              <MapPin className="size-4" />
            </span>
            <select
              id="city"
              name="city"
              value={city}
              onChange={(e) => {
                setCity(e.target.value as City | "");
                clearError("city");
              }}
              data-state={errors.city ? "error" : undefined}
              aria-invalid={errors.city ? true : undefined}
              aria-describedby={errors.city ? "city-error" : undefined}
              className={cn(
                controlBase,
                "h-[38px] cursor-pointer appearance-none py-2 pr-9 pl-9",
                !city && "text-rs-fg-3",
              )}
            >
              <option value="" className="bg-rs-surface text-rs-fg-3">
                Wybierz miasto
              </option>
              {CITIES.map((value) => (
                <option key={value} value={value} className="bg-rs-surface text-rs-fg">
                  {CITY_LABELS[value]}
                </option>
              ))}
            </select>
            <span className="text-rs-fg-3 pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2">
              <ChevronDown className="size-4" />
            </span>
          </div>
          <FieldError id="city-error" message={errors.city} />
        </div>

        <ChoiceCards
          id="propertyType"
          name="propertyType"
          legend="Typ nieruchomości"
          options={PROPERTY_TYPE_OPTIONS}
          value={propertyType}
          onChange={(v) => {
            setPropertyType(v);
            clearError("propertyType");
          }}
          error={errors.propertyType}
        />

        <ChoiceCards
          id="transaction"
          name="transaction"
          legend="Transakcja"
          options={TRANSACTION_OPTIONS}
          value={transaction}
          onChange={(v) => {
            setTransaction(v);
            clearError("transaction");
          }}
          error={errors.transaction}
        />

        <FormField
          id="price"
          label="Cena (PLN)"
          inputMode="numeric"
          autoComplete="off"
          value={price}
          onChange={(v) => {
            setPrice(v);
            clearError("price");
          }}
          placeholder="np. 650000"
          error={errors.price}
          icon={<Banknote className="size-4" />}
        />

        <div className="tablet:grid-cols-2 grid grid-cols-1 gap-3">
          <FormField
            id="areaM2"
            label="Metraż (m²) — opcjonalnie"
            inputMode="decimal"
            autoComplete="off"
            value={areaM2}
            onChange={(v) => {
              setAreaM2(v);
              clearError("areaM2");
            }}
            placeholder="np. 54,5"
            error={errors.areaM2}
            icon={<Ruler className="size-4" />}
          />
          <FormField
            id="rooms"
            label="Liczba pokoi — opcjonalnie"
            inputMode="numeric"
            autoComplete="off"
            value={rooms}
            onChange={(v) => {
              setRooms(v);
              clearError("rooms");
            }}
            placeholder={`${limits.minRooms}–${limits.maxRooms}`}
            error={errors.rooms}
            icon={<DoorOpen className="size-4" />}
          />
        </div>

        <div>
          <label htmlFor="description" className="text-rs-fg-2 mb-1 block text-[11.5px] font-semibold">
            Opis — opcjonalnie
          </label>
          <textarea
            id="description"
            name="description"
            rows={5}
            value={description}
            onChange={(e) => {
              setDescription(e.target.value);
              clearError("description");
            }}
            placeholder="Najważniejsze informacje o nieruchomości"
            data-state={errors.description ? "error" : undefined}
            aria-invalid={errors.description ? true : undefined}
            aria-describedby={errors.description ? "description-error description-count" : "description-count"}
            className={cn(controlBase, "block min-h-[96px] resize-y px-3 py-2 leading-relaxed")}
          />
          <div className="flex items-start justify-between gap-3">
            <FieldError id="description-error" message={errors.description} />
            <p
              id="description-count"
              className={cn(
                "mt-1 ml-auto shrink-0 text-[11.5px] tabular-nums",
                descriptionTooLong ? "text-rs-danger-fg font-semibold" : "text-rs-fg-3",
              )}
            >
              {descriptionLength}/{limits.maxDescriptionLength}
            </p>
          </div>
        </div>
      </div>

      <ServerError message={serverError} />

      <SubmitButton pending={submitting} pendingText="Zapisywanie…" icon={<Save className="size-4" />}>
        Zapisz i pokaż agentów
      </SubmitButton>
    </form>
  );
}
