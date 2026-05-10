import { type ButtonHTMLAttributes, forwardRef } from 'react';
import { clsx } from 'clsx';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'ghost' | 'outline';
  size?: 'sm' | 'md' | 'icon';
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'md', ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={clsx(
          'inline-flex items-center justify-center rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:pointer-events-none disabled:opacity-50',
          {
            'bg-accent text-surface-0 hover:bg-accent-bright shadow-glow-sm': variant === 'default',
            'hover:bg-surface-hover text-text-secondary hover:text-text-primary': variant === 'ghost',
            'border border-border hover:border-accent/60 hover:bg-surface-hover text-text-secondary hover:text-text-primary': variant === 'outline',
          },
          {
            'h-7 px-3 text-xs': size === 'sm',
            'h-9 px-4 text-sm': size === 'md',
            'h-8 w-8 p-0': size === 'icon',
          },
          className,
        )}
        {...props}
      />
    );
  },
);
Button.displayName = 'Button';
