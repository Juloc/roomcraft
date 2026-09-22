import type { ButtonHTMLAttributes, PropsWithChildren } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

export function Button({ variant = "secondary", className = "", ...props }: ButtonProps) {
  return <button className={`rc-button rc-button--${variant} ${className}`.trim()} {...props} />;
}

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

export interface SegmentedControlProps<T extends string> {
  value: T;
  options: readonly SegmentedOption<T>[];
  onChange: (value: T) => void;
  ariaLabel: string;
}

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: SegmentedControlProps<T>) {
  return (
    <div className="rc-segmented" role="group" aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className="rc-segmented__item"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Panel({ children }: PropsWithChildren) {
  return <section className="rc-panel">{children}</section>;
}

export function Toolbar({ children }: PropsWithChildren) {
  return <div className="rc-toolbar">{children}</div>;
}

export { LengthField } from "./LengthField";
export type { LengthFieldProps } from "./LengthField";
export { formatLengthInput, parseLengthInput } from "./length";

export { NumberField } from "./NumberField";
export type { NumberFieldProps } from "./NumberField";
export { TextField } from "./TextField";
export type { TextFieldProps } from "./TextField";
export { formatNumberInput, parseNumberInput } from "./number";

export interface LayerListItem {
  id: string;
  label: string;
  selected: boolean;
  visible: boolean;
  locked: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
}

export interface LayerListProps {
  items: readonly LayerListItem[];
  emptyLabel?: string;
  onSelect(id: string): void;
  onToggleVisible(id: string): void;
  onToggleLocked(id: string): void;
  onMoveUp(id: string): void;
  onMoveDown(id: string): void;
  onDelete(id: string): void;
}

export function LayerList({
  items,
  emptyLabel = "No layers",
  onSelect,
  onToggleVisible,
  onToggleLocked,
  onMoveUp,
  onMoveDown,
  onDelete,
}: LayerListProps) {
  if (items.length === 0) {
    return <div className="rc-layer-list__empty">{emptyLabel}</div>;
  }

  return (
    <div className="rc-layer-list" role="list">
      {items.map((item) => (
        <div
          key={item.id}
          className={`rc-layer-list__row${item.selected ? " rc-layer-list__row--selected" : ""}`}
          role="listitem"
        >
          <button
            type="button"
            className="rc-layer-list__select"
            aria-pressed={item.selected}
            onClick={() => onSelect(item.id)}
          >
            <span className="rc-layer-list__label">{item.label}</span>
          </button>
          <div className="rc-layer-list__actions">
            <Button
              variant="ghost"
              className="rc-layer-list__action"
              aria-label={item.visible ? `Hide ${item.label}` : `Show ${item.label}`}
              title={item.visible ? "Hide" : "Show"}
              onClick={() => onToggleVisible(item.id)}
            >
              {item.visible ? "On" : "Off"}
            </Button>
            <Button
              variant="ghost"
              className="rc-layer-list__action"
              aria-label={item.locked ? `Unlock ${item.label}` : `Lock ${item.label}`}
              title={item.locked ? "Unlock" : "Lock"}
              onClick={() => onToggleLocked(item.id)}
            >
              {item.locked ? "Lock" : "Free"}
            </Button>
            <Button
              variant="ghost"
              className="rc-layer-list__action rc-layer-list__action--compact"
              disabled={!item.canMoveUp}
              aria-label={`Move ${item.label} toward front`}
              title="Move toward front"
              onClick={() => onMoveUp(item.id)}
            >
              ↑
            </Button>
            <Button
              variant="ghost"
              className="rc-layer-list__action rc-layer-list__action--compact"
              disabled={!item.canMoveDown}
              aria-label={`Move ${item.label} toward back`}
              title="Move toward back"
              onClick={() => onMoveDown(item.id)}
            >
              ↓
            </Button>
            <Button
              variant="ghost"
              className="rc-layer-list__action rc-layer-list__action--compact"
              aria-label={`Delete ${item.label}`}
              title="Delete"
              onClick={() => onDelete(item.id)}
            >
              ×
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
