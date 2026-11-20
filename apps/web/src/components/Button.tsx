import type { ButtonHTMLAttributes } from 'react'

const STYLES = {
  primary: 'bg-ink text-surface',
  secondary: 'border border-line bg-surface text-ink hover:border-ink-soft',
} as const

export function Button({
  variant = 'secondary',
  className = '',
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof STYLES }) {
  return (
    <button
      type={type}
      className={`cursor-pointer rounded-md px-4 py-2 text-sm font-medium disabled:cursor-default disabled:opacity-60 ${STYLES[variant]} ${className}`}
      {...props}
    />
  )
}
