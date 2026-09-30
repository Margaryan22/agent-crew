// Small accessible building blocks. Every input has a visible <label>, so users and tests can
// find it by name (getByLabel), and every message has a role (getByRole('alert' | 'status')).
import { useId } from 'react'
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react'

export function Button({ className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={`rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50 ${className}`}
      {...props}
    />
  )
}

type FieldProps = InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string }

export function Field({ label, error, id, className = '', ...props }: FieldProps) {
  const autoId = useId()
  const inputId = id ?? autoId
  const errorId = `${inputId}-error`
  return (
    <div className="mb-4">
      <label htmlFor={inputId} className="mb-1 block text-sm font-medium">
        {label}
      </label>
      <input
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className={`w-full rounded-md border border-slate-300 px-3 py-2 ${className}`}
        {...props}
      />
      {error ? (
        <p id={errorId} className="mt-1 text-sm text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  )
}

export function Alert({ children, kind = 'error' }: { children: ReactNode; kind?: 'error' | 'success' }) {
  return kind === 'error' ? (
    <p role="alert" className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
      {children}
    </p>
  ) : (
    <p role="status" className="mb-4 rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">
      {children}
    </p>
  )
}
