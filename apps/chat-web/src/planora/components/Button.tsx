import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
  iconPosition?: 'left' | 'right';
  square?: boolean;
}

/**
 * Nút bấm Planora cơ sở
 * Nhận đầy đủ native HTML button props (disabled, onClick, type, aria-*), không bọc API logic.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'secondary',
    size = 'md',
    icon,
    iconPosition = 'left',
    square = false,
    className = '',
    children,
    type = 'button',
    disabled,
    ...rest
  },
  ref
) {
  const classes = [
    'planora-btn',
    `planora-btn-${variant}`,
    `planora-btn-${size}`,
    square ? 'planora-btn-square' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      ref={ref}
      type={type}
      className={classes}
      disabled={disabled}
      {...rest}
    >
      {icon && iconPosition === 'left' && (
        <span className="planora-btn-icon" aria-hidden="true">
          {icon}
        </span>
      )}
      {children}
      {icon && iconPosition === 'right' && (
        <span className="planora-btn-icon" aria-hidden="true">
          {icon}
        </span>
      )}
    </button>
  );
});
