'use client'

import { useTheme } from 'next-themes'
import { Toaster as Sonner, ToasterProps } from 'sonner'

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = 'system' } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps['theme']}
      className="toaster group"
      style={
        {
          // Professional “ink” toasts (match app: dark, subtle border, pink accent)
          '--normal-bg': 'oklch(0.08 0.01 260)',
          '--normal-text': 'oklch(0.94 0.005 90)',
          '--normal-border': 'oklch(0.18 0.008 260)',
          '--success-bg': 'oklch(0.08 0.01 260)',
          '--success-text': 'oklch(0.94 0.005 90)',
          '--success-border': 'oklch(0.18 0.008 260)',
          '--error-bg': 'oklch(0.08 0.01 260)',
          '--error-text': 'oklch(0.94 0.005 90)',
          '--error-border': 'oklch(0.18 0.008 260)',
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast:
            'group toast bg-[var(--normal-bg)] text-[var(--normal-text)] border border-[var(--normal-border)] shadow-2xl shadow-black/50 rounded-xl',
          title: 'font-medium text-[0.875rem]',
          description: 'text-[0.8125rem] text-[color:oklch(0.72_0.01_90)]',
          actionButton:
            'bg-[#eca8d6] text-black hover:bg-[#eca8d6]/90 font-medium',
          cancelButton:
            'bg-transparent text-[var(--normal-text)] hover:bg-white/5 border border-white/10',
          closeButton:
            'text-[var(--normal-text)]/70 hover:text-[var(--normal-text)]',
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
