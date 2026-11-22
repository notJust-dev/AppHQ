import type { ButtonHTMLAttributes } from 'react'

const VARIANTS = {
  primary: 'border border-transparent bg-ink text-surface hover:bg-ink/85',
  secondary: 'border border-line-strong bg-surface text-ink hover:bg-raised',
  ghost: 'border border-transparent text-ink-soft hover:bg-raised hover:text-ink',
  danger: 'border border-transparent bg-danger text-surface hover:bg-danger/90',
  /** A destructive action's first step; the confirming step is `danger`. */
  dangerOutline: 'border border-danger/40 bg-surface text-danger hover:bg-danger-soft',
} as const

const SIZES = {
  sm: 'h-7 gap-1.5 px-2.5 text-[13px]',
  md: 'h-8 gap-2 px-3 text-[13px]',
} as const

export type ButtonVariant = keyof typeof VARIANTS

/** The look of a button, for a link that acts as one. */
export const buttonClass = (variant: ButtonVariant = 'secondary', size: keyof typeof SIZES = 'md') =>
  `inline-flex shrink-0 cursor-pointer items-center justify-center rounded-md font-medium whitespace-nowrap transition-colors disabled:cursor-default disabled:opacity-50 ${VARIANTS[variant]} ${SIZES[size]}`

export function Button({
  variant = 'secondary',
  size = 'md',
  className = '',
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: keyof typeof SIZES
}) {
  return <button type={type} className={`${buttonClass(variant, size)} ${className}`} {...props} />
}
