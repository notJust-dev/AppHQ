import { MessageCircleHeart } from 'lucide-react'
import { SidebarMenuButton, SidebarMenuItem, useSidebar } from '@/components/ui/sidebar'
import { openFeedbackForm, useFeedbackAvailable } from '@/lib/feedback'

/** "Send feedback" in the sidebar footer, shown only while error reporting is on. */
export function FeedbackButton() {
  const available = useFeedbackAvailable()
  const { isMobile, setOpenMobile } = useSidebar()
  if (!available) return null
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        tooltip="Send feedback"
        onClick={() => {
          // On a phone the sidebar is a modal sheet, which would keep focus out of the form.
          if (isMobile) setOpenMobile(false)
          void openFeedbackForm()
        }}
      >
        <MessageCircleHeart />
        <span>Send feedback</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}
