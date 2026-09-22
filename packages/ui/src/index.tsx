import type { ButtonHTMLAttributes, PropsWithChildren, ReactNode } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

export function Button({ variant = "secondary", className = "", ...props }: ButtonProps) {
  return <button className={`rc-button rc-button--${variant} ${className}`.trim()} {...props} />;
}


export type IconName =
  | "back"
  | "undo"
  | "redo"
  | "more"
  | "select"
  | "wall"
  | "opening"
  | "furniture"
  | "blueprint"
  | "close";

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  switch (name) {
    case "back":
      return <svg {...common}><path d="m15 18-6-6 6-6" /></svg>;
    case "undo":
      return <svg {...common}><path d="M9 7 4 12l5 5" /><path d="M20 18a8 8 0 0 0-8-8H4" /></svg>;
    case "redo":
      return <svg {...common}><path d="m15 7 5 5-5 5" /><path d="M4 18a8 8 0 0 1 8-8h8" /></svg>;
    case "more":
      return <svg {...common}><circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="19" cy="12" r="1" fill="currentColor" stroke="none" /></svg>;
    case "select":
      return <svg {...common}><path d="m6 3 12 9-7 1-3 7Z" /></svg>;
    case "wall":
      return <svg {...common}><path d="M4 19 19 4" /><path d="M7 21 21 7" /></svg>;
    case "opening":
      return <svg {...common}><path d="M5 20V4h14v16" /><path d="M8 20V8h8v12" /><path d="M13 14h.01" /></svg>;
    case "furniture":
      return <svg {...common}><path d="M5 11h14v8H5z" /><path d="M7 11V7h10v4" /><path d="M7 19v2M17 19v2" /></svg>;
    case "blueprint":
      return <svg {...common}><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M8 4v16M4 9h16M13 9v11" /></svg>;
    case "close":
      return <svg {...common}><path d="m6 6 12 12M18 6 6 18" /></svg>;
  }
}

export function IconButton({
  icon,
  label,
  className = "",
  ...props
}: Omit<ButtonProps, "children"> & { icon: IconName; label: string }) {
  return (
    <Button
      {...props}
      className={`rc-icon-button ${className}`.trim()}
      aria-label={label}
      title={props.title ?? label}
    >
      <Icon name={icon} />
    </Button>
  );
}

export function Menu({
  label,
  children,
  className = "",
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <details className={`rc-menu ${className}`.trim()}>
      <summary className="rc-menu__trigger" aria-label={label} title={label}>
        <Icon name="more" />
      </summary>
      <div className="rc-menu__content">{children}</div>
    </details>
  );
}

export function Sheet({
  open,
  title,
  onClose,
  children,
  className = "",
}: {
  open: boolean;
  title: string;
  onClose(): void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <>
      <button
        type="button"
        className={`rc-sheet-backdrop${open ? " rc-sheet-backdrop--open" : ""}`}
        aria-label={`Close ${title}`}
        tabIndex={open ? 0 : -1}
        onClick={onClose}
      />
      <aside className={`rc-sheet${open ? " rc-sheet--open" : ""} ${className}`.trim()} aria-label={title}>
        <div className="rc-sheet__handle" aria-hidden="true" />
        <div className="rc-sheet__header">
          <strong>{title}</strong>
          <IconButton icon="close" label={`Close ${title}`} variant="ghost" onClick={onClose} />
        </div>
        <div className="rc-sheet__content">{children}</div>
      </aside>
    </>
  );
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
export { SelectField } from "./SelectField";
export type { SelectFieldOption, SelectFieldProps } from "./SelectField";
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
