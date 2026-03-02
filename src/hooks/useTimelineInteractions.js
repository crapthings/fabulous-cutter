import { useCallback, useEffect, useMemo, useRef } from 'react'
import { MIN_CLIP_MS } from '../store/editorStore'

const SNAP_MS = 80

function clamp (value, min, max) {
  return Math.min(max, Math.max(min, value))
}

export function useTimelineInteractions ({
  mediaRef,
  hasMedia,
  durationMs,
  playheadMs,
  activeRange,
  patchActiveRange,
  setActiveRange,
  setPlayheadMs,
  setTimelineDragging
}) {
  const trackRef = useRef(null)
  const cleanupDragRef = useRef(null)
  const lastActiveEdgeRef = useRef('end')

  const rangeStyle = useMemo(() => {
    if (!durationMs) {
      return { left: '0%', width: '0%' }
    }

    const left = (activeRange.startMs / durationMs) * 100
    const width = ((activeRange.endMs - activeRange.startMs) / durationMs) * 100

    return {
      left: `${left}%`,
      width: `${Math.max(0, width)}%`
    }
  }, [activeRange.endMs, activeRange.startMs, durationMs])

  useEffect(() => {
    return () => {
      if (cleanupDragRef.current) {
        cleanupDragRef.current()
      }
    }
  }, [])

  function readPointMs (clientX, width, left, shouldDamp) {
    if (!width || !durationMs) {
      return 0
    }

    let point = clientX - left

    if (shouldDamp) {
      if (point < 0) {
        point *= 0.28
      } else if (point > width) {
        point = width + (point - width) * 0.28
      }
    }

    const bounded = clamp(point, 0, width)
    return (bounded / width) * durationMs
  }

  function snapMs (value, snapTargets) {
    let next = value
    for (const target of snapTargets) {
      if (Math.abs(next - target) <= SNAP_MS) {
        next = target
      }
    }
    return clamp(next, 0, durationMs)
  }

  const movePreviewTo = useCallback((targetMs) => {
    if (!mediaRef.current) {
      return
    }
    mediaRef.current.currentTime = targetMs / 1000
    setPlayheadMs(targetMs)
  }, [mediaRef, setPlayheadMs])

  const nudgeRangeEdge = useCallback((edge, stepMs) => {
    if (!hasMedia) {
      return
    }

    if (edge === 'start') {
      const nextStart = clamp(
        activeRange.startMs + stepMs,
        0,
        activeRange.endMs - MIN_CLIP_MS
      )
      patchActiveRange({ startMs: nextStart })
      movePreviewTo(nextStart)
      return
    }

    const nextEnd = clamp(
      activeRange.endMs + stepMs,
      activeRange.startMs + MIN_CLIP_MS,
      durationMs
    )
    patchActiveRange({ endMs: nextEnd })
    movePreviewTo(nextEnd)
  }, [activeRange.endMs, activeRange.startMs, durationMs, hasMedia, movePreviewTo, patchActiveRange])

  function onHandleKeyDown (edge, event) {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) {
      return
    }

    lastActiveEdgeRef.current = edge
    event.preventDefault()
    const amount = event.shiftKey ? 100 : 10
    const direction = event.key === 'ArrowRight' ? 1 : -1
    nudgeRangeEdge(edge, amount * direction)
  }

  function onRangePointerDown (mode, event) {
    if (!hasMedia || !trackRef.current) {
      return
    }

    if (mode !== 'range' && event.currentTarget instanceof HTMLElement) {
      lastActiveEdgeRef.current = mode
      event.currentTarget.focus()
    }

    event.preventDefault()
    mediaRef.current?.pause()

    const rect = trackRef.current.getBoundingClientRect()
    const width = rect.width
    const left = rect.left
    const snapTargets = [0, durationMs, playheadMs]
    const dragStart = {
      mode,
      startMs: activeRange.startMs,
      endMs: activeRange.endMs,
      anchorMs: readPointMs(event.clientX, width, left, false)
    }

    setTimelineDragging(true)

    const onMove = (moveEvent) => {
      const currentMs = readPointMs(moveEvent.clientX, width, left, true)
      const snappedMs = snapMs(currentMs, snapTargets)

      if (dragStart.mode === 'start') {
        const nextStart = clamp(snappedMs, 0, dragStart.endMs - MIN_CLIP_MS)
        patchActiveRange({ startMs: nextStart })
        movePreviewTo(nextStart)
        return
      }

      if (dragStart.mode === 'end') {
        const nextEnd = clamp(snappedMs, dragStart.startMs + MIN_CLIP_MS, durationMs)
        patchActiveRange({ endMs: nextEnd })
        movePreviewTo(nextEnd)
        return
      }

      const spanMs = dragStart.endMs - dragStart.startMs
      const deltaMs = snappedMs - dragStart.anchorMs
      const nextStart = clamp(dragStart.startMs + deltaMs, 0, durationMs - spanMs)
      const nextEnd = nextStart + spanMs
      setActiveRange({ startMs: nextStart, endMs: nextEnd })
      movePreviewTo(nextStart)
    }

    const onStop = () => {
      setTimelineDragging(false)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onStop)
      window.removeEventListener('pointercancel', onStop)
      cleanupDragRef.current = null
    }

    cleanupDragRef.current = onStop
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onStop)
    window.addEventListener('pointercancel', onStop)
  }

  useEffect(() => {
    const onGlobalKeyDown = (event) => {
      if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) {
        return
      }

      if (event.metaKey || event.ctrlKey || event.altKey) {
        return
      }

      const target = event.target
      const isTypingTarget = target instanceof HTMLElement &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)

      if (isTypingTarget || !hasMedia) {
        return
      }

      event.preventDefault()
      const amount = event.shiftKey ? 100 : 10
      const direction = event.key === 'ArrowRight' ? 1 : -1
      nudgeRangeEdge(lastActiveEdgeRef.current, amount * direction)
    }

    window.addEventListener('keydown', onGlobalKeyDown)
    return () => {
      window.removeEventListener('keydown', onGlobalKeyDown)
    }
  }, [hasMedia, nudgeRangeEdge])

  return {
    trackRef,
    rangeStyle,
    onRangePointerDown,
    onHandleKeyDown
  }
}
