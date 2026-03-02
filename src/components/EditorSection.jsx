import { useEffect, useRef, useState } from 'react'
import WaveSurfer from 'wavesurfer.js'
import { MIN_CLIP_MS, useEditorStore } from '../store/editorStore'
import { formatMs } from '../utils/time'
import { useTimelineInteractions } from '../hooks/useTimelineInteractions'

export default function EditorSection () {
  const mediaRef = useRef(null)
  const audioWaveformContainerRef = useRef(null)
  const videoWaveformContainerRef = useRef(null)
  const wavesurferRef = useRef(null)
  const isRangePreviewingRef = useRef(false)
  const videoThumbCacheRef = useRef(new Map())
  const videoThumbJobRef = useRef(0)
  const videoFpsJobRef = useRef(0)
  const audioBitrateJobRef = useRef(0)
  const [timelineWidth, setTimelineWidth] = useState(0)
  const [videoFramePreview, setVideoFramePreview] = useState({
    sourceUrl: '',
    images: [],
    status: 'idle',
    count: 0
  })
  const [videoFps, setVideoFps] = useState(null)
  const [audioBitrateKbps, setAudioBitrateKbps] = useState(null)

  const mediaType = useEditorStore((state) => state.mediaType)
  const session = useEditorStore((state) => state.sessions[state.mediaType])
  const sourceFile = session.sourceFile
  const sourceUrl = session.sourceUrl
  const durationMs = session.durationMs
  const playheadMs = session.playheadMs
  const activeRange = session.activeRange
  const exportState = session.exportState
  const pendingSeekMs = session.pendingSeekMs
  const pendingSeekToken = session.pendingSeekToken
  const videoOutputFormat = useEditorStore((state) => state.videoOutputFormat)
  const audioOutputFormat = useEditorStore((state) => state.audioOutputFormat)
  const isTimelineDragging = session.isTimelineDragging

  const setMediaType = useEditorStore((state) => state.setMediaType)
  const setPlayheadMs = useEditorStore((state) => state.setPlayheadMs)
  const setActiveRange = useEditorStore((state) => state.setActiveRange)
  const patchActiveRange = useEditorStore((state) => state.patchActiveRange)
  const setTimelineDragging = useEditorStore((state) => state.setTimelineDragging)
  const loadSourceFile = useEditorStore((state) => state.loadSourceFile)
  const setLoadedMetadata = useEditorStore((state) => state.setLoadedMetadata)
  const addClip = useEditorStore((state) => state.addClip)
  const consumePendingSeek = useEditorStore((state) => state.consumePendingSeek)
  const setVideoOutputFormat = useEditorStore((state) => state.setVideoOutputFormat)
  const setAudioOutputFormat = useEditorStore((state) => state.setAudioOutputFormat)

  const mediaAccept = mediaType === 'video' ? 'video/*' : 'audio/*'
  const hasMedia = Boolean(sourceUrl && durationMs > 0)
  const rangeDurationMs = activeRange.endMs - activeRange.startMs
  const canAddClip = hasMedia && rangeDurationMs >= MIN_CLIP_MS
  const activeFormatValue = mediaType === 'video' ? videoOutputFormat : audioOutputFormat

  const { trackRef, rangeStyle, onRangePointerDown, onHandleKeyDown } = useTimelineInteractions({
    mediaRef,
    hasMedia,
    durationMs,
    playheadMs,
    activeRange,
    patchActiveRange,
    setActiveRange,
    setPlayheadMs,
    setTimelineDragging
  })

  useEffect(() => {
    const target = trackRef.current
    if (!target) {
      return
    }

    const update = () => {
      const width = Math.max(320, Math.floor(target.clientWidth))
      setTimelineWidth(width)
    }

    const rafId = requestAnimationFrame(update)
    const observer = new ResizeObserver(update)
    observer.observe(target)

    return () => {
      cancelAnimationFrame(rafId)
      observer.disconnect()
    }
  }, [trackRef])

  useEffect(() => {
    const jobId = videoFpsJobRef.current + 1
    videoFpsJobRef.current = jobId
    let isDisposed = false

    if (mediaType !== 'video' || !sourceFile || !sourceUrl) {
      setVideoFps(null)
      return
    }

    const loadFps = async () => {
      try {
        const moduleApi = await import('mediabunny')
        if (isDisposed || videoFpsJobRef.current !== jobId) {
          return
        }

        const input = new moduleApi.Input({
          source: new moduleApi.BlobSource(sourceFile),
          formats: moduleApi.ALL_FORMATS
        })

        try {
          const track = await input.getPrimaryVideoTrack()
          if (!track) {
            setVideoFps(null)
            return
          }

          const stats = await track.computePacketStats(180)
          if (!isDisposed && videoFpsJobRef.current === jobId && Number.isFinite(stats.averagePacketRate)) {
            setVideoFps(stats.averagePacketRate)
          }
        } finally {
          input.dispose()
        }
      } catch {
        if (!isDisposed && videoFpsJobRef.current === jobId) {
          setVideoFps(null)
        }
      }
    }

    loadFps()

    return () => {
      isDisposed = true
    }
  }, [mediaType, sourceFile, sourceUrl])

  useEffect(() => {
    const jobId = audioBitrateJobRef.current + 1
    audioBitrateJobRef.current = jobId
    let isDisposed = false

    if (mediaType !== 'audio' || !sourceFile || !sourceUrl) {
      setAudioBitrateKbps(null)
      return
    }

    const loadBitrate = async () => {
      try {
        const moduleApi = await import('mediabunny')
        if (isDisposed || audioBitrateJobRef.current !== jobId) {
          return
        }

        const input = new moduleApi.Input({
          source: new moduleApi.BlobSource(sourceFile),
          formats: moduleApi.ALL_FORMATS
        })

        try {
          const track = await input.getPrimaryAudioTrack()
          if (!track) {
            setAudioBitrateKbps(null)
            return
          }

          const stats = await track.computePacketStats(320)
          if (!isDisposed && audioBitrateJobRef.current === jobId && Number.isFinite(stats.averageBitrate)) {
            setAudioBitrateKbps(stats.averageBitrate / 1000)
          }
        } finally {
          input.dispose()
        }
      } catch {
        if (!isDisposed && audioBitrateJobRef.current === jobId) {
          setAudioBitrateKbps(null)
        }
      }
    }

    loadBitrate()

    return () => {
      isDisposed = true
    }
  }, [mediaType, sourceFile, sourceUrl])

  useEffect(() => {
    if (wavesurferRef.current) {
      wavesurferRef.current.destroy()
      wavesurferRef.current = null
    }

    const waveContainer = mediaType === 'audio'
      ? audioWaveformContainerRef.current
      : videoWaveformContainerRef.current
    if ((mediaType !== 'audio' && mediaType !== 'video') || !sourceUrl || !waveContainer) {
      return
    }

    const wavesurfer = WaveSurfer.create({
      container: waveContainer,
      url: sourceUrl,
      interact: false,
      cursorWidth: 0,
      height: 44,
      normalize: true,
      waveColor: 'rgba(58, 51, 43, 0.32)',
      progressColor: 'rgba(58, 51, 43, 0.32)',
      barWidth: 2,
      barGap: 1,
      barRadius: 2
    })

    wavesurferRef.current = wavesurfer

    return () => {
      wavesurfer.destroy()
      wavesurferRef.current = null
    }
  }, [mediaType, sourceUrl])

  useEffect(() => {
    const jobId = videoThumbJobRef.current + 1
    videoThumbJobRef.current = jobId
    let isDisposed = false

    if (mediaType !== 'video' || !sourceUrl || !sourceFile || durationMs <= 0 || timelineWidth <= 0) {
      return
    }

    const generateFrames = async () => {
      await Promise.resolve()
      if (isDisposed || videoThumbJobRef.current !== jobId) {
        return
      }

      const count = Math.max(8, Math.min(40, Math.ceil(timelineWidth / 72)))
      const cache = videoThumbCacheRef.current
      const images = Array.from({ length: count }, (_, index) => (
        cache.get(`${sourceUrl}::${count}::${index}`) ?? ''
      ))

      setVideoFramePreview({
        sourceUrl,
        images,
        status: images.every(Boolean) ? 'ready' : 'loading',
        count
      })

      try {
        const moduleApi = await import('mediabunny')
        if (isDisposed || videoThumbJobRef.current !== jobId) {
          return
        }

        const input = new moduleApi.Input({
          source: new moduleApi.BlobSource(sourceFile),
          formats: moduleApi.ALL_FORMATS
        })

        try {
          const track = await input.getPrimaryVideoTrack()
          if (!track) {
            if (!isDisposed && videoThumbJobRef.current === jobId) {
              setVideoFramePreview({ sourceUrl, images: [], status: 'no-video', count })
            }
            return
          }

          const sink = new moduleApi.CanvasSink(track, {
            width: Math.max(80, Math.floor(timelineWidth / count)),
            fit: 'cover'
          })
          const durationSec = durationMs / 1000
          for (let index = 0; index < count; index += 1) {
            if (isDisposed || videoThumbJobRef.current !== jobId) {
              return
            }

            if (images[index]) {
              continue
            }

            const ratio = count === 1 ? 0.5 : index / (count - 1)
            const ts = Math.min(Math.max(ratio * durationSec, 0), Math.max(durationSec - 0.02, 0))
            const wrapped = await sink.getCanvas(ts)
            if (!wrapped) {
              continue
            }

            const canvas = wrapped.canvas
            let dataUrl = ''

            if ('toDataURL' in canvas && typeof canvas.toDataURL === 'function') {
              dataUrl = canvas.toDataURL('image/jpeg', 0.72)
            } else if ('convertToBlob' in canvas && typeof canvas.convertToBlob === 'function') {
              const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.72 })
              dataUrl = await new Promise((resolve) => {
                const reader = new FileReader()
                reader.onload = () => resolve(String(reader.result || ''))
                reader.readAsDataURL(blob)
              })
            }

            if (dataUrl) {
              cache.set(`${sourceUrl}::${count}::${index}`, dataUrl)
              images[index] = dataUrl
              if (index % 2 === 1 || index === count - 1) {
                if (!isDisposed && videoThumbJobRef.current === jobId) {
                  setVideoFramePreview({
                    sourceUrl,
                    images: [...images],
                    status: images.every(Boolean) ? 'ready' : 'loading',
                    count
                  })
                }
              }
            }
          }

          if (!isDisposed && videoThumbJobRef.current === jobId) {
            if (images.every((item) => !item)) {
              setVideoFramePreview({ sourceUrl, images: [], status: 'no-video', count })
            } else {
              setVideoFramePreview({ sourceUrl, images, status: 'ready', count })
            }
          }
        } finally {
          input.dispose()
        }
      } catch {
        if (!isDisposed && videoThumbJobRef.current === jobId) {
          setVideoFramePreview({ sourceUrl, images: [], status: 'no-video', count: 0 })
        }
      }
    }

    generateFrames()

    return () => {
      isDisposed = true
    }
  }, [durationMs, mediaType, sourceFile, sourceUrl, timelineWidth])

  useEffect(() => {
    if (typeof pendingSeekMs !== 'number') {
      return
    }

    const media = mediaRef.current
    if (!media) {
      consumePendingSeek()
      return
    }

    const wasPlaying = !media.paused
    media.currentTime = pendingSeekMs / 1000
    setPlayheadMs(pendingSeekMs)
    consumePendingSeek()

    if (wasPlaying) {
      isRangePreviewingRef.current = true
      media.play().catch(() => {
        isRangePreviewingRef.current = false
      })
      return
    }

    isRangePreviewingRef.current = false
  }, [consumePendingSeek, pendingSeekMs, pendingSeekToken, setPlayheadMs])

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.code !== 'Space') {
        return
      }

      const target = event.target
      const isTypingTarget = target instanceof HTMLElement &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)

      if (isTypingTarget) {
        return
      }

      const media = mediaRef.current
      if (!media || !hasMedia) {
        return
      }

      event.preventDefault()

      const startSec = activeRange.startMs / 1000
      const endSec = activeRange.endMs / 1000
      const loopEpsilonSec = 0.02

      if (!media.paused) {
        media.pause()
        isRangePreviewingRef.current = false
        return
      }

      if (media.currentTime < startSec || media.currentTime >= endSec - loopEpsilonSec) {
        media.currentTime = startSec
        setPlayheadMs(activeRange.startMs)
      }

      isRangePreviewingRef.current = true
      media.play().catch(() => {
        isRangePreviewingRef.current = false
      })
    }

    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [activeRange.endMs, activeRange.startMs, hasMedia, setPlayheadMs])

  function formatFps (fps) {
    if (!Number.isFinite(fps) || fps <= 0) {
      return ''
    }
    const rounded = Math.round(fps)
    const value = Math.abs(fps - rounded) < 0.05 ? String(rounded) : fps.toFixed(2)
    return `${value} fps`
  }

  function formatKbps (kbps) {
    if (!Number.isFinite(kbps) || kbps <= 0) {
      return ''
    }
    const rounded = Math.round(kbps)
    return `${rounded} kbps`
  }

  return (
    <section className='editor-card'>
      <header className='editor-head'>
        <div>
          <p className='eyebrow'>Fabulous Cutter</p>
          <h1>Trim Fast. Export Clean.</h1>
        </div>
        <div className='tab-group' role='tablist' aria-label='Media Type'>
          <button type='button' className={mediaType === 'video' ? 'tab active' : 'tab'} onClick={() => setMediaType('video')} role='tab' aria-selected={mediaType === 'video'}>Video</button>
          <button type='button' className={mediaType === 'audio' ? 'tab active' : 'tab'} onClick={() => setMediaType('audio')} role='tab' aria-selected={mediaType === 'audio'}>Audio</button>
        </div>
      </header>

      <section className='media-controls'>
        <div className='media-load'>
          <label htmlFor='source-file' className='file-picker'>
            <span>Import {mediaType} file</span>
            <input id='source-file' type='file' accept={mediaAccept} onChange={(event) => loadSourceFile(event.target.files?.[0])} />
          </label>
          <p className='file-meta'>
            {sourceFile
              ? `${formatMs(durationMs)}${mediaType === 'video' ? ` · ${formatFps(videoFps) || '... fps'}` : ''}${mediaType === 'audio' ? ` · ${formatKbps(audioBitrateKbps) || '... kbps'}` : ''} · ${sourceFile.name}`
              : 'No file loaded'}
          </p>
        </div>
        <label className='format-picker'>
          {mediaType === 'video' ? 'Video Format' : 'Audio Format'}
          <select
            value={activeFormatValue}
            onChange={(event) => {
              if (mediaType === 'video') {
                setVideoOutputFormat(event.target.value)
                return
              }
              setAudioOutputFormat(event.target.value)
            }}
            disabled={exportState === 'exporting'}
          >
            {mediaType === 'video'
              ? (
                <>
                  <option value='auto'>Auto</option>
                  <option value='webm'>WebM</option>
                  <option value='mp4'>MP4</option>
                </>
                )
              : (
                <>
                  <option value='auto'>Auto</option>
                  <option value='wav'>WAV</option>
                  <option value='mp3'>MP3</option>
                </>
                )}
          </select>
        </label>
      </section>

      <section className={`player-wrap ${mediaType}`}>
        {!sourceUrl && (
          <div className='media-placeholder'>
            <strong>No media loaded</strong>
            <span>Import a {mediaType} file to start trimming.</span>
          </div>
        )}
        {sourceUrl && mediaType === 'video'
          ? (
            <video
              ref={mediaRef}
              className='media-player'
              src={sourceUrl}
              controls
              onLoadedMetadata={(event) => setLoadedMetadata(event.currentTarget.duration)}
              onTimeUpdate={(event) => {
                const media = event.currentTarget
                const currentMs = media.currentTime * 1000
                if (isRangePreviewingRef.current && currentMs >= activeRange.endMs) {
                  media.pause()
                  media.currentTime = activeRange.endMs / 1000
                  setPlayheadMs(activeRange.endMs)
                  isRangePreviewingRef.current = false
                  return
                }
                setPlayheadMs(currentMs)
              }}
            />
            )
          : null}
        {sourceUrl && mediaType === 'audio'
          ? (
            <audio
              ref={mediaRef}
              className='media-player audio'
              src={sourceUrl}
              controls
              onLoadedMetadata={(event) => setLoadedMetadata(event.currentTarget.duration)}
              onTimeUpdate={(event) => {
                const media = event.currentTarget
                const currentMs = media.currentTime * 1000
                if (isRangePreviewingRef.current && currentMs >= activeRange.endMs) {
                  media.pause()
                  media.currentTime = activeRange.endMs / 1000
                  setPlayheadMs(activeRange.endMs)
                  isRangePreviewingRef.current = false
                  return
                }
                setPlayheadMs(currentMs)
              }}
            />
            )
          : null}
      </section>

      <section className='timeline-wrap'>
        <div className='timeline-labels'>
          <span className='timeline-pill edge'>{formatMs(activeRange.startMs)}</span>
          <span className='timeline-pill playhead'>{formatMs(playheadMs)}</span>
          <span className='timeline-pill edge'>{formatMs(activeRange.endMs)}</span>
        </div>

        <div ref={trackRef} className={isTimelineDragging ? 'timeline dragging' : 'timeline'} style={{ '--playhead': durationMs ? (playheadMs / durationMs) * 100 : 0 }}>
          {mediaType === 'video' && sourceUrl && (
            <div className='video-thumbs-bg' aria-hidden>
              {videoFramePreview.sourceUrl === sourceUrl && videoFramePreview.images.length > 0 && (
                <div
                  className='video-frames-row'
                  style={{ gridTemplateColumns: `repeat(${videoFramePreview.count || videoFramePreview.images.length}, minmax(0, 1fr))` }}
                >
                  {videoFramePreview.images.map((imageUrl, index) => (
                    imageUrl
                      ? <img key={`${index}-${imageUrl.slice(0, 16)}`} src={imageUrl} alt='Video frame preview' />
                      : <div key={`empty-${index}`} className='video-frame-empty' />
                  ))}
                </div>
              )}
              {(videoFramePreview.sourceUrl !== sourceUrl || videoFramePreview.status === 'loading') && (
                <div className='video-preview-status'>Generating video preview...</div>
              )}
              {videoFramePreview.sourceUrl === sourceUrl && videoFramePreview.status === 'no-video' && (
                <div className='video-preview-status'>No video track</div>
              )}
            </div>
          )}
          {mediaType === 'audio' && sourceUrl && (
            <div className='audio-wave-bg' ref={audioWaveformContainerRef} aria-hidden />
          )}
          <div className='clip-range' style={rangeStyle}>
            <button type='button' className='handle left' aria-label='Trim start' onPointerDown={(event) => onRangePointerDown('start', event)} onKeyDown={(event) => onHandleKeyDown('start', event)} />
            <button type='button' className='range-core' aria-label='Move current range' onPointerDown={(event) => onRangePointerDown('range', event)} />
            <button type='button' className='handle right' aria-label='Trim end' onPointerDown={(event) => onRangePointerDown('end', event)} onKeyDown={(event) => onHandleKeyDown('end', event)} />
          </div>
        </div>
        {mediaType === 'video' && sourceUrl && (
          <div className='video-preview-stack'>
            <section className='video-wave-strip' aria-label='Audio waveform preview'>
              <div className='video-wave-canvas' ref={videoWaveformContainerRef} aria-hidden />
            </section>
          </div>
        )}
        <p className='hint'>Drag handles for start/end. Drag middle bar to move full clip. Arrow keys nudge by 10ms, Shift+Arrow by 100ms.</p>
      </section>

      <section className='action-row'>
        <button type='button' className='btn primary' disabled={!canAddClip} onClick={addClip}>Add Clip</button>
      </section>
    </section>
  )
}
