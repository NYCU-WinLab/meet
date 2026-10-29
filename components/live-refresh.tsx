"use client"

import { useRouter } from "next/navigation"
import * as React from "react"

// Keeps the page current: when anyone changes data, /api/events says so and
// the page fetches itself again (router.refresh also drops prefetched pages,
// so the next click is fresh too). Bursts of changes refresh once.
export function LiveRefresh() {
  const router = useRouter()
  React.useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let opened = false
    const refresh = () => {
      clearTimeout(timer)
      timer = setTimeout(() => router.refresh(), 300)
    }
    const source = new EventSource("/api/events")
    source.onmessage = refresh
    // After a dropped connection (sleep, network change) changes may have
    // been missed, so catch up once it is back.
    source.onopen = () => {
      if (opened) refresh()
      opened = true
    }
    return () => {
      clearTimeout(timer)
      source.close()
    }
  }, [router])
  return null
}
