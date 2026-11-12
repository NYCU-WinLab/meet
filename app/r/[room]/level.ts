"use client"

import * as React from "react"

/**
 * Moves an element with a microphone: its scale along one axis follows the
 * loudest sample, rising at once and falling slowly so speech reads as a
 * level and not a flicker. The element is written directly, never through
 * React state, and only when the value moves a whole step.
 */
export function useLevel(
  track: MediaStreamTrack | undefined,
  bar: React.RefObject<HTMLElement | null>,
  axis: "x" | "y"
) {
  React.useEffect(() => {
    const element = bar.current
    if (!track || !element) return
    const context = new AudioContext()
    const source = context.createMediaStreamSource(new MediaStream([track]))
    const analyser = context.createAnalyser()
    analyser.fftSize = 512
    source.connect(analyser)
    const samples = new Uint8Array(analyser.fftSize)
    const scale = axis === "x" ? "scaleX" : "scaleY"
    let level = 0
    let written = -1
    let frame = 0
    const draw = () => {
      analyser.getByteTimeDomainData(samples)
      let peak = 0
      for (const sample of samples)
        peak = Math.max(peak, Math.abs(sample - 128))
      level = Math.max(Math.min(1, (peak / 128) * 2.5), level * 0.9)
      const next = Math.round(level * 50) / 50
      if (next !== written) {
        element.style.transform = `${scale}(${next})`
        written = next
      }
      frame = requestAnimationFrame(draw)
    }
    draw()
    return () => {
      cancelAnimationFrame(frame)
      void context.close()
      element.style.transform = ""
    }
  }, [track, bar, axis])
}
