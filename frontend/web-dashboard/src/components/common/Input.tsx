/**
 * Input component — supports label, error, hint, icons.
 */

import { forwardRef, type InputHTMLAttributes } from 'react';
import { clsx } from 'clsx';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
  iconLeft?: React.ReactNode;
  iconRight?: React.ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  function Input({ label, error, hint, iconLeft, iconRight, className, id, ...props }, ref) {
    const inputId = id || `input-${Math.random().toString(36).slice(2)}`;

    return (
      <div className="w-full">
        {label && (
          <label htmlFor={inputId} className="block text-sm font-medium text-slate-700 mb-1.5">
            {label}
            {props.required && <span className="text-danger-500 ml-1">*</span>}
          </label>
        )}
        <div className="relative">
          {iconLeft && (
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
              {iconLeft}
            </div>
          )}
          <input
            ref={ref}
            id={inputId}
            className={clsx(
              'block w-full rounded-lg border transition-colors',
              'focus:outline-none focus:ring-2 focus:ring-offset-0',
              'disabled:bg-slate-50 disabled:cursor-not-allowed',
              error
                ? 'border-danger-500 focus:border-danger-500 focus:ring-danger-500'
                : 'border-slate-300 focus:border-brand-500 focus:ring-brand-500',
              iconLeft ? 'pl-10' : 'pl-3',
              iconRight ? 'pr-10' : 'pr-3',
              'py-2 text-sm text-slate-900 placeholder:text-slate-400',
              className,
            )}
            aria-invalid={!!error}
            aria-describedby={error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined}
            {...props}
          />
          {iconRight && (
            <div className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400">
              {iconRight}
            </div>
          )}
        </div>
        {error && (
          <p id={`${inputId}-error`} className="mt-1.5 text-sm text-danger-600">
            {error}
          </p>
        )}
        {!error && hint && (
          <p id={`${inputId}-hint`} className="mt-1.5 text-sm text-slate-500">
            {hint}
          </p>
        )}
      </div>
    );
  },
);