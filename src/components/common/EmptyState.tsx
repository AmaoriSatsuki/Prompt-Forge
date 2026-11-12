interface EmptyStateProps {
  text: string;
  hint?: string;
}

export function EmptyState({ text, hint }: EmptyStateProps) {
  return (
    <div className="pf-empty">
      <p className="pf-empty__text">{text}</p>
      {hint ? <p className="pf-empty__hint">{hint}</p> : null}
    </div>
  );
}
