import type { ButtonHTMLAttributes } from 'react';

type ButtonVariant = 'ghost' | 'primary' | 'danger';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  compact?: boolean;
}

export function Button({
  variant = 'ghost',
  compact = false,
  className,
  type = 'button',
  ...rest
}: ButtonProps) {
  const classes = [
    'pf-btn',
    `pf-btn--${variant}`,
    compact ? 'pf-btn--compact' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  return <button type={type} className={classes} {...rest} />;
}
