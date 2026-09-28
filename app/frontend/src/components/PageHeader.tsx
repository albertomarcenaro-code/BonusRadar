import type { ReactNode } from "react";

export default function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  testId,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  testId: string;
}) {
  return (
    <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between animate-rise">
      <div className="max-w-2xl">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#0056B3]">{eyebrow}</p>
        <h1 className="mt-2 text-3xl font-bold text-slate-900 sm:text-4xl" data-testid={testId}>
          {title}
        </h1>
        {description && <p className="mt-2 text-slate-600">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
