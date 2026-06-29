import type { ButtonHTMLAttributes, ReactNode } from "react";

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: ReactNode;
  label: string;
  compact?: boolean;
}

export function IconButton({ icon, label, compact = false, className = "", ...props }: IconButtonProps) {
  return (
    <button
      {...props}
      type={props.type ?? "button"}
      className={["icon-button", compact ? "icon-button--compact" : "", className].join(" ")}
      aria-label={label}
      title={label}
    >
      <span className="icon-button__icon" aria-hidden="true">
        {icon}
      </span>
      {!compact ? <span className="icon-button__label">{label}</span> : null}
    </button>
  );
}
