import { useId } from "react";

export interface SelectFieldOption {
  value: string;
  label: string;
}

export interface SelectFieldProps {
  label: string;
  value: string;
  options: readonly SelectFieldOption[];
  onChange(value: string): void;
  helpText?: string;
  disabled?: boolean;
}

export function SelectField({
  label,
  value,
  options,
  onChange,
  helpText,
  disabled = false,
}: SelectFieldProps) {
  const id = useId();
  const helpId = `${id}-help`;

  return (
    <label className="rc-field" htmlFor={id}>
      <span className="rc-field__label">{label}</span>
      <select
        id={id}
        className="rc-input"
        value={value}
        disabled={disabled}
        aria-describedby={helpText ? helpId : undefined}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {helpText ? (
        <span id={helpId} className="rc-field__help">
          {helpText}
        </span>
      ) : null}
    </label>
  );
}
