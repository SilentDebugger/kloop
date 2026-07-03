import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { IconBack } from "../../ui/icons";

/** compact header with a round back button, as in the detail mockups */
export function BackBar({ title, subtitle, right }: { title: ReactNode; subtitle?: ReactNode; right?: ReactNode }) {
  const navigate = useNavigate();
  return (
    <div className="flex items-center gap-3">
      <button
        onClick={() => navigate(-1)}
        aria-label="Back"
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-card shadow-card cursor-pointer transition-shadow hover:shadow-float"
      >
        <IconBack size={18} />
      </button>
      <div className="min-w-0 flex-1">
        <div className="truncate font-bold leading-tight text-ink">{title}</div>
        {subtitle && <div className="truncate text-[12px] text-ink-secondary">{subtitle}</div>}
      </div>
      {right}
    </div>
  );
}
