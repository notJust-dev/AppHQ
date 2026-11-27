import { useQuery } from '@tanstack/react-query'
import { MessageCircleHeart } from 'lucide-react'
import { SidebarMenuButton, SidebarMenuItem, useSidebar } from '@/components/ui/sidebar'
import { getAccountFn } from '@/fns/account'
import { openFeedbackForm, useFeedbackAvailable } from '@/lib/feedback'

/**
 * "Send feedback" in the sidebar footer, shown only while error reporting is on. Feedback goes
 * with the email of the account the person signed in with; signed in with the dashboard
 * password, there is none and the form asks.
 */
export function FeedbackButton() {
  const available = useFeedbackAvailable()
  const { data: email = null } = useQuery({
    queryKey: ['feedback-email'],
    queryFn: async () => (await getAccountFn()).account?.email ?? null,
    enabled: available,
    staleTime: Infinity,
  })
  const { isMobile, setOpenMobile } = useSidebar()
  if (!available) return null
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        tooltip="Send feedback"
        onClick={() => {
          // On a phone the sidebar is a modal sheet, which would keep focus out of the form.
          if (isMobile) setOpenMobile(false)
          void openFeedbackForm(email)
        }}
      >
        <MessageCircleHeart />
        <span>Send feedback</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}
