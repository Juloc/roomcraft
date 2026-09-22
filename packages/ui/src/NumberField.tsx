import { useEffect, useId, useState } from "react";
import { formatNumberInput, parseNumberInput } from "./number";

export interface NumberFieldProps {
  label: string;
  value: number;
  onCommit(value: number): void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  disabled?: boolean;
  helpText?: string;
  maximumFractionDigits?: number;
}

export function NumberField({
  label,
  value,
  onCommit,
  min,
  max,
  step,
  suffix,
  disabled = false,
  helpText,
  maximumFractionDigits = 3,
}: NumberFieldProps) {
  const inputId = useId();
  const errorId = `${inputId}-error`;
  const helpId = `${inputId}-help`;
  const [draft, setDraft] = useState(() => formatNumberInput(value, maximumFractionDigits));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(formatNumberInput(value, maximumFractionDigits));
    setError(null);
  }, [value, maximumFractionDigits]);

  function reset() {
    setDraft(formatNumberInput(value, maximumFractionDigits));
    setError(null);
  }

  function commit() {
    const parsed = parseNumberInput(draft);
    if (parsed === null) {
      setError("Enter a valid number.");
      return;
    }
    if (min !== undefined && parsed < min) {
      setError(`Value must be at least ${min}.`);
      return;
    }
    if (max !== undefined && parsed > max) {
      setError(`Value must be at most ${max}.`);
      return;
    }

    const stepped =
      step && step > 0 ? Math.round(parsed / step) * step : parsed;

    try {
      onCommit(stepped);
      setDraft(formatNumberInput(stepped, maximumFractionDigits));
      setError(null);
    } catch (commitError) {
      setError(commitError instanceof Error ? commitError.message : "Value could not be changed.");
    }
  }

  const describedBy = [error ? errorId : null, helpText ? helpId : null]
    .filter(Boolean)
    .join(" ") || undefined;

  return (
    <label className="rc-field" htmlFor={inputId}>
      <span className="rc-field__label">{label}</span>
      <span className="rc-number-field">
        <input
          id={inputId}
          className={`rc-input${error ? " rc-input--invalid" : ""}`}
          type="text"
          inputMode="decimal"
          value={draft}
          disabled={disabled}
          aria-invalid={error ? "true" : undefined}
          aria-describedby={describedBy}
          onChange={(event) => {
            setDraft(event.target.value);
            if (error) setError(null);
          }}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commit();
              event.currentTarget.select();
            }
            if (event.key === "Escape") {
              event.preventDefault();
              reset();
              event.currentTarget.blur();
            }
          }}
        />
        {suffix ? <span className="rc-number-field__suffix">{suffix}</span> : null}
      </span>
      {helpText ? (
        <span id={helpId} className="rc-field__help">
          {helpText}
        </span>
      ) : null}
      {error ? (
        <span id={errorId} className="rc-field__error" role="alert">
          {error}
        </span>
      ) : null}
    </label>
  );
}
