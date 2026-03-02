import { create } from 'zustand'

export const MIN_CLIP_MS = 100

function toClipName (index) {
  return `clip-${String(index + 1).padStart(3, '0')}`
}

function sourceBaseName (name) {
  return name.replace(/\.[^.]+$/, '')
}

function sourceExtension (name) {
  const match = name.toLowerCase().match(/\.([^.]+)$/)
  return match ? match[1] : ''
}

function clamp (value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function createSessionState () {
  return {
    sourceFile: null,
    sourceUrl: '',
    durationMs: 0,
    playheadMs: 0,
    activeRange: { startMs: 0, endMs: 0 },
    clips: [],
    selectedClipId: '',
    exportState: 'idle',
    exportProgress: { current: 0, total: 0, clipName: '', clipProgress: 0 },
    clipExportMap: {},
    editingClipId: '',
    editingClipName: '',
    draggingClipId: '',
    dragOverClipId: '',
    isTimelineDragging: false,
    pendingSeekMs: null,
    pendingSeekToken: 0
  }
}

function getSession (state, mediaType = state.mediaType) {
  return state.sessions[mediaType]
}

let mediabunnyModule = null
let activeConversion = null
let exportCancelRequested = false

async function loadMediabunny () {
  if (!mediabunnyModule) {
    mediabunnyModule = await import('mediabunny')
  }
  return mediabunnyModule
}

function downloadArrayBuffer (buffer, fileName, mimeType) {
  const blob = new Blob([buffer], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 3000)
}

function outputFormatFor (state, mediaType, moduleApi, sourceFile) {
  const ext = sourceFile ? sourceExtension(sourceFile.name) : ''

  if (mediaType === 'video') {
    if (state.videoOutputFormat === 'mp4') {
      return new moduleApi.Mp4OutputFormat()
    }
    if (state.videoOutputFormat === 'webm') {
      return new moduleApi.WebMOutputFormat()
    }
    if (ext === 'webm') {
      return new moduleApi.WebMOutputFormat()
    }
    return new moduleApi.Mp4OutputFormat()
  }

  if (state.audioOutputFormat === 'wav') {
    return new moduleApi.WavOutputFormat()
  }
  if (state.audioOutputFormat === 'mp3') {
    return new moduleApi.Mp3OutputFormat()
  }
  if (ext === 'wav') {
    return new moduleApi.WavOutputFormat()
  }
  if (ext === 'mp3') {
    return new moduleApi.Mp3OutputFormat()
  }
  return new moduleApi.Mp3OutputFormat()
}

const initialState = {
  mediaType: 'video',
  videoOutputFormat: 'auto',
  audioOutputFormat: 'auto',
  sessions: {
    video: createSessionState(),
    audio: createSessionState()
  }
}

export const useEditorStore = create((set, get) => ({
  ...initialState,

  setMediaType: (mediaType) => set({ mediaType }),

  setPlayheadMs: (playheadMs) => {
    set((state) => ({
      sessions: {
        ...state.sessions,
        [state.mediaType]: {
          ...getSession(state),
          playheadMs
        }
      }
    }))
  },

  setActiveRange: (activeRange) => {
    set((state) => ({
      sessions: {
        ...state.sessions,
        [state.mediaType]: {
          ...getSession(state),
          activeRange
        }
      }
    }))
  },

  patchActiveRange: (patch) => {
    set((state) => ({
      sessions: {
        ...state.sessions,
        [state.mediaType]: {
          ...getSession(state),
          activeRange: {
            ...getSession(state).activeRange,
            ...patch
          }
        }
      }
    }))
  },

  setVideoOutputFormat: (videoOutputFormat) => set({ videoOutputFormat }),

  setAudioOutputFormat: (audioOutputFormat) => set({ audioOutputFormat }),

  setTimelineDragging: (isTimelineDragging) => {
    set((state) => ({
      sessions: {
        ...state.sessions,
        [state.mediaType]: {
          ...getSession(state),
          isTimelineDragging
        }
      }
    }))
  },

  beginRenameClip: (clip) => {
    set((state) => ({
      sessions: {
        ...state.sessions,
        [state.mediaType]: {
          ...getSession(state),
          editingClipId: clip.id,
          editingClipName: clip.name
        }
      }
    }))
  },

  setEditingClipName: (editingClipName) => {
    set((state) => ({
      sessions: {
        ...state.sessions,
        [state.mediaType]: {
          ...getSession(state),
          editingClipName
        }
      }
    }))
  },

  cancelRenameClip: () => {
    set((state) => ({
      sessions: {
        ...state.sessions,
        [state.mediaType]: {
          ...getSession(state),
          editingClipId: '',
          editingClipName: ''
        }
      }
    }))
  },

  commitRenameClip: (id) => {
    const state = get()
    const session = getSession(state)
    const targetId = id ?? session.editingClipId
    const name = session.editingClipName.trim()
    if (!targetId || !name) {
      get().cancelRenameClip()
      return
    }

    get().renameClip(targetId, name)
    get().cancelRenameClip()
  },

  startDraggingClip: (draggingClipId) => {
    set((state) => ({
      sessions: {
        ...state.sessions,
        [state.mediaType]: {
          ...getSession(state),
          draggingClipId,
          dragOverClipId: ''
        }
      }
    }))
  },

  setDragOverClipId: (dragOverClipId) => {
    set((state) => ({
      sessions: {
        ...state.sessions,
        [state.mediaType]: {
          ...getSession(state),
          dragOverClipId
        }
      }
    }))
  },

  endDraggingClip: () => {
    set((state) => ({
      sessions: {
        ...state.sessions,
        [state.mediaType]: {
          ...getSession(state),
          draggingClipId: '',
          dragOverClipId: ''
        }
      }
    }))
  },

  loadSourceFile: (file) => {
    if (!file) {
      return
    }

    const state = get()
    const mediaType = state.mediaType
    const session = getSession(state, mediaType)

    if (session.sourceUrl) {
      URL.revokeObjectURL(session.sourceUrl)
    }

    exportCancelRequested = true
    if (activeConversion) {
      activeConversion.cancel()
    }

    const nextUrl = URL.createObjectURL(file)
    set((prev) => ({
      sessions: {
        ...prev.sessions,
        [mediaType]: {
          ...createSessionState(),
          sourceFile: file,
          sourceUrl: nextUrl
        }
      }
    }))
  },

  setLoadedMetadata: (durationSeconds) => {
    const mediaDurationMs = Math.max(
      MIN_CLIP_MS,
      Math.floor(durationSeconds * 1000)
    )
    const initialEndMs = Math.min(mediaDurationMs, 5000)

    set((state) => ({
      // Preserve per-tab trim/playhead when metadata re-fires (e.g. tab switch).
      sessions: {
        ...state.sessions,
        [state.mediaType]: {
          ...(() => {
            const current = getSession(state)
            const hasExistingRange =
              current.durationMs > 0 &&
              current.activeRange.endMs - current.activeRange.startMs >= MIN_CLIP_MS

            if (!hasExistingRange) {
              return {
                ...current,
                durationMs: mediaDurationMs,
                playheadMs: 0,
                activeRange: {
                  startMs: 0,
                  endMs: initialEndMs
                }
              }
            }

            const maxStart = Math.max(0, mediaDurationMs - MIN_CLIP_MS)
            const nextStart = clamp(current.activeRange.startMs, 0, maxStart)
            const nextEnd = clamp(
              current.activeRange.endMs,
              nextStart + MIN_CLIP_MS,
              mediaDurationMs
            )

            return {
              ...current,
              durationMs: mediaDurationMs,
              playheadMs: clamp(current.playheadMs, 0, mediaDurationMs),
              activeRange: {
                startMs: nextStart,
                endMs: nextEnd
              }
            }
          })()
        }
      }
    }))
  },

  addClip: () => {
    const state = get()
    const session = getSession(state)
    const rangeDurationMs = session.activeRange.endMs - session.activeRange.startMs
    if (!session.sourceFile || session.durationMs <= 0 || rangeDurationMs < MIN_CLIP_MS) {
      return
    }

    set((prev) => {
      const current = getSession(prev)
      const nextClip = {
        id: crypto.randomUUID(),
        name: toClipName(current.clips.length),
        startMs: current.activeRange.startMs,
        endMs: current.activeRange.endMs,
        durationMs: current.activeRange.endMs - current.activeRange.startMs
      }

      return {
        sessions: {
          ...prev.sessions,
          [prev.mediaType]: {
            ...current,
            clips: [...current.clips, nextClip],
            selectedClipId: nextClip.id,
            clipExportMap: {
              ...current.clipExportMap,
              [nextClip.id]: { status: 'idle', error: '' }
            }
          }
        }
      }
    })
  },

  deleteClip: (id) => {
    set((state) => {
      const session = getSession(state)
      const nextMap = { ...session.clipExportMap }
      delete nextMap[id]

      return {
        sessions: {
          ...state.sessions,
          [state.mediaType]: {
            ...session,
            clips: session.clips.filter((clip) => clip.id !== id),
            selectedClipId: session.selectedClipId === id ? '' : session.selectedClipId,
            editingClipId: session.editingClipId === id ? '' : session.editingClipId,
            editingClipName: session.editingClipId === id ? '' : session.editingClipName,
            draggingClipId: session.draggingClipId === id ? '' : session.draggingClipId,
            dragOverClipId: session.dragOverClipId === id ? '' : session.dragOverClipId,
            clipExportMap: nextMap
          }
        }
      }
    })
  },

  renameClip: (id, name) => {
    set((state) => {
      const session = getSession(state)
      return {
        sessions: {
          ...state.sessions,
          [state.mediaType]: {
            ...session,
            clips: session.clips.map((clip) => (
              clip.id === id ? { ...clip, name } : clip
            ))
          }
        }
      }
    })
  },

  reorderClips: (draggedId, targetId) => {
    if (!draggedId || !targetId || draggedId === targetId) {
      return
    }

    set((state) => {
      const session = getSession(state)
      const sourceIndex = session.clips.findIndex((clip) => clip.id === draggedId)
      const targetIndex = session.clips.findIndex((clip) => clip.id === targetId)

      if (sourceIndex === -1 || targetIndex === -1) {
        return state
      }

      const next = [...session.clips]
      const [moved] = next.splice(sourceIndex, 1)
      next.splice(targetIndex, 0, moved)
      return {
        sessions: {
          ...state.sessions,
          [state.mediaType]: {
            ...session,
            clips: next
          }
        }
      }
    })
  },

  openClip: (id) => {
    const state = get()
    const session = getSession(state)
    const clip = session.clips.find((item) => item.id === id)
    if (!clip) {
      return null
    }

    set({
      sessions: {
        ...state.sessions,
        [state.mediaType]: {
          ...session,
          selectedClipId: id,
          playheadMs: clip.startMs,
          activeRange: {
            startMs: clip.startMs,
            endMs: clip.endMs
          },
          pendingSeekMs: clip.startMs,
          pendingSeekToken: session.pendingSeekToken + 1
        }
      }
    })
    return clip.startMs
  },

  consumePendingSeek: () => {
    set((state) => ({
      sessions: {
        ...state.sessions,
        [state.mediaType]: {
          ...getSession(state),
          pendingSeekMs: null
        }
      }
    }))
  },

  markClipExport: (clipId, patch, mediaType = get().mediaType) => {
    set((state) => {
      const session = getSession(state, mediaType)
      return {
        sessions: {
          ...state.sessions,
          [mediaType]: {
            ...session,
            clipExportMap: {
              ...session.clipExportMap,
              [clipId]: {
                status: session.clipExportMap[clipId]?.status ?? 'idle',
                error: session.clipExportMap[clipId]?.error ?? '',
                ...patch
              }
            }
          }
        }
      }
    })
  },

  exportAllClips: async () => {
    const state = get()
    const session = getSession(state)
    await get().exportClips(session.clips, true, state.mediaType)
  },

  retryFailedClips: async () => {
    const state = get()
    const session = getSession(state)
    const failed = session.clips.filter((clip) => session.clipExportMap[clip.id]?.status === 'error')
    await get().exportClips(failed, false, state.mediaType)
  },

  exportClips: async (clipList, resetBeforeExport, mediaType = get().mediaType) => {
    const state = get()
    const session = getSession(state, mediaType)
    if (!session.sourceFile || clipList.length === 0 || session.exportState === 'exporting') {
      return
    }

    exportCancelRequested = false

    set((prev) => {
      const current = getSession(prev, mediaType)
      const nextSession = {
        ...current,
        exportState: 'exporting',
        exportProgress: {
          current: 0,
          total: clipList.length,
          clipName: '',
          clipProgress: 0
        }
      }

      if (resetBeforeExport) {
        const nextMap = { ...current.clipExportMap }
        for (const clip of clipList) {
          nextMap[clip.id] = { status: 'idle', error: '' }
        }
        nextSession.clipExportMap = nextMap
      }

      return {
        sessions: {
          ...prev.sessions,
          [mediaType]: nextSession
        }
      }
    })

    const moduleApi = await loadMediabunny()
    let failedCount = 0

    for (let index = 0; index < clipList.length; index += 1) {
      const clip = clipList[index]
      if (exportCancelRequested) {
        break
      }

      get().markClipExport(clip.id, { status: 'exporting', error: '' }, mediaType)

      set((prev) => {
        const current = getSession(prev, mediaType)
        return {
          sessions: {
            ...prev.sessions,
            [mediaType]: {
              ...current,
              exportProgress: {
                current: index + 1,
                total: clipList.length,
                clipName: clip.name,
                clipProgress: 0
              }
            }
          }
        }
      })

      try {
        await get().exportSingleClip(clip, mediaType)
        get().markClipExport(clip.id, { status: 'success', error: '' }, mediaType)
      } catch (error) {
        if (error instanceof moduleApi.ConversionCanceledError || exportCancelRequested) {
          get().markClipExport(clip.id, { status: 'idle', error: '' }, mediaType)
          break
        }

        failedCount += 1
        get().markClipExport(clip.id, {
          status: 'error',
          error: error instanceof Error ? error.message : 'Export failed'
        }, mediaType)
      }
    }

    set((prev) => {
      const current = getSession(prev, mediaType)
      let exportState = 'done'
      if (exportCancelRequested) {
        exportState = 'canceled'
      } else if (failedCount > 0) {
        exportState = 'error'
      }

      return {
        sessions: {
          ...prev.sessions,
          [mediaType]: {
            ...current,
            exportState
          }
        }
      }
    })
  },

  exportSingleClip: async (clip, mediaType = get().mediaType) => {
    const state = get()
    const session = getSession(state, mediaType)
    if (!session.sourceFile) {
      throw new Error('No source file selected')
    }

    const moduleApi = await loadMediabunny()
    const input = new moduleApi.Input({
      source: new moduleApi.BlobSource(session.sourceFile),
      formats: moduleApi.ALL_FORMATS
    })

    const output = new moduleApi.Output({
      format: outputFormatFor(state, mediaType, moduleApi, session.sourceFile),
      target: new moduleApi.BufferTarget()
    })

    try {
      const conversion = await moduleApi.Conversion.init({
        input,
        output,
        trim: {
          start: clip.startMs / 1000,
          end: clip.endMs / 1000
        }
      })

      if (!conversion.isValid) {
        const reason = conversion.discardedTracks[0]?.reason ?? 'unknown'
        throw new Error(`Cannot export clip: ${reason}`)
      }

      activeConversion = conversion
      conversion.onProgress = (progress) => {
        set((prev) => {
          const current = getSession(prev, mediaType)
          return {
            sessions: {
              ...prev.sessions,
              [mediaType]: {
                ...current,
                exportProgress: { ...current.exportProgress, clipProgress: progress }
              }
            }
          }
        })
      }

      await conversion.execute()

      if (exportCancelRequested) {
        throw new moduleApi.ConversionCanceledError()
      }

      const outputBuffer = output.target.buffer
      if (!outputBuffer) {
        throw new Error('Empty output buffer')
      }

      const latest = get()
      const latestSession = getSession(latest, mediaType)
      const format = output.format
      const fileName = `${sourceBaseName(latestSession.sourceFile.name)}_${clip.name}${format.fileExtension}`
      downloadArrayBuffer(outputBuffer, fileName, format.mimeType)
    } finally {
      input.dispose()
      activeConversion = null
    }
  },

  cancelExport: async () => {
    exportCancelRequested = true
    if (activeConversion) {
      await activeConversion.cancel()
    }
  },

  cleanupStore: () => {
    exportCancelRequested = true
    if (activeConversion) {
      activeConversion.cancel()
    }

    const state = get()
    for (const key of ['video', 'audio']) {
      const url = state.sessions[key].sourceUrl
      if (url) {
        URL.revokeObjectURL(url)
      }
    }
  }
}))
