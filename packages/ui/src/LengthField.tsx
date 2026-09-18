import { useEffect, useId, useState } from "react";
import { formatLengthInput, parseLengthInput } from "./length";

export interface LengthFieldProps {
  label: string;
  valueMm: number;
  onCommit(valueMm: number): void;
  minMm?: number;
  disabled?: boolean;
  helpText?: string;
}

export function LengthField({
  label,
  valueMm,
  onCommit,
  minMm = 1,
  disabled = false,
  helpText,
}: LengthFieldProps) {
  const inputId = useId();
  const errorId = `${inputId}-error`;
  const helpId = `${inputId}-help`;
  const [draft, setDraft] = useState(() => formatLengthInput(valueMm));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(formatLengthInput(valueMm));
    setError(null);
  }, [valueMm]);

  function reset() {
    setDraft(formatLengthInput(valueMm));
    setError(null);
  }

  function commit() {
    const parsed = parseLengthInput(draft);
    if (parsed === null) {
      setError("Enter a length such as 4520 mm, 452 cm or 4.52 m.");
      return;
    }
    if (parsed < minMm) {
      setError(`Length must be at least ${minMm} mm.`);
      return;
    }

    try {
      onCommit(parsed);
      setDraft(formatLengthInput(parsed));
      setError(null);
    } catch (commitError) {
      setError(commitError instanceof Error ? commitError.message : "Length could not be changed.");
    }
  }

  const describedBy = [error ? errorId : null, helpText ? helpId : null]
    .filter(Boolean)
    .join(" ") || undefined;

  return (
    <label className="rc-field" htmlFor={inputId}>
      <span className="rc-field__label">{label}</span>
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
