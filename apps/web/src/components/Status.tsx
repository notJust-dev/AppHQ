import { AlertTriangle, CircleAlert } from 'lucide-react'
import type { ReactNode } from 'react'
import { Badge } from '@/components/ui/badge'

/**
 * A state in words. Fine states stay quiet; only a problem gets colour, with an icon so it does
 * not rest on colour alone.
 */
export function Status({ tone, children }: { tone: 'ok' | 'off' | 'warn' | 'danger'; children: ReactNode }) {
  if (tone === 'warn' || tone === 'danger') {
    const Icon = tone === 'warn' ? AlertTriangle : CircleAlert
    return (
      <Badge variant={tone === 'warn' ? 'warning' : 'destructive'}>
        <Icon aria-hidden="true" />
        {children}
      </Badge>
    )
  }
  return (
    <Badge variant="outline" className="text-muted-foreground">
      <span
        // Grey, not green: colour on this page always means a funnel stage.
        className={`size-1.5 rounded-full ${tone === 'ok' ? 'bg-muted-foreground' : 'border border-faint'}`}
        aria-hidden="true"
      />
      {children}
    </Badge>
  )
}
