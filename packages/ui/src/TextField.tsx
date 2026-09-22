import { useId } from "react";

export interface TextFieldProps {
  label: string;
  value: string;
  onChange(value: string): void;
  placeholder?: string;
  disabled?: boolean;
  helpText?: string;
  autoComplete?: string;
  inputMode?: "text" | "search" | "email" | "url";
}

export function TextField({
  label,
  value,
  onChange,
  placeholder,
  disabled = false,
  helpText,
  autoComplete = "off",
  inputMode = "text",
}: TextFieldProps) {
  const inputId = useId();
  const helpId = `${inputId}-help`;

  return (
    <label className="rc-field" htmlFor={inputId}>
      <span className="rc-field__label">{label}</span>
      <input
        id={inputId}
        className="rc-input"
        type={inputMode === "search" ? "search" : "text"}
        inputMode={inputMode === "search" ? "search" : inputMode}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete={autoComplete}
        aria-describedby={helpText ? helpId : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      {helpText ? (
        <span id={helpId} className="rc-field__help">
          {helpText}
        </span>
      ) : null}
    </label>
  );
}
