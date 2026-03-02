import { useEditorStore } from '../store/editorStore'
import { formatMs } from '../utils/time'

export default function ClipsSection () {
  const session = useEditorStore((state) => state.sessions[state.mediaType])
  const clips = session.clips
  const sourceFile = session.sourceFile
  const exportState = session.exportState
  const exportProgress = session.exportProgress
  const selectedClipId = session.selectedClipId
  const clipExportMap = session.clipExportMap
  const editingClipId = session.editingClipId
  const editingClipName = session.editingClipName
  const draggingClipId = session.draggingClipId
  const dragOverClipId = session.dragOverClipId

  const deleteClip = useEditorStore((state) => state.deleteClip)
  const reorderClips = useEditorStore((state) => state.reorderClips)
  const openClip = useEditorStore((state) => state.openClip)
  const beginRenameClip = useEditorStore((state) => state.beginRenameClip)
  const setEditingClipName = useEditorStore((state) => state.setEditingClipName)
  const cancelRenameClip = useEditorStore((state) => state.cancelRenameClip)
  const commitRenameClip = useEditorStore((state) => state.commitRenameClip)
  const startDraggingClip = useEditorStore((state) => state.startDraggingClip)
  const setDragOverClipId = useEditorStore((state) => state.setDragOverClipId)
  const endDraggingClip = useEditorStore((state) => state.endDraggingClip)
  const exportAllClips = useEditorStore((state) => state.exportAllClips)

  const canExport = Boolean(sourceFile && clips.length > 0 && exportState !== 'exporting')

  function onOpenClip (id) {
    openClip(id)
  }

  return (
    <section className='clips-card'>
      <header className='clips-head'>
        <h2>Clips</h2>
        <button type='button' className='btn' disabled={!canExport} onClick={exportAllClips}>
          Export All ({clips.length})
        </button>
      </header>

      {clips.length === 0
        ? <p className='empty-state'>No clips yet. Add one from the active trim range.</p>
        : (
          <ul className='clip-list'>
            {clips.map((clip) => (
              <li
                key={clip.id}
                className={['clip-item', selectedClipId === clip.id ? 'active' : '', editingClipId === clip.id ? 'editing' : '', draggingClipId === clip.id ? 'dragging' : '', dragOverClipId === clip.id ? 'drag-over' : ''].join(' ').trim()}
                draggable={editingClipId !== clip.id}
                onDragStart={() => startDraggingClip(clip.id)}
                onDragOver={(event) => {
                  event.preventDefault()
                  if (draggingClipId && draggingClipId !== clip.id) {
                    setDragOverClipId(clip.id)
                  }
                }}
                onDrop={(event) => {
                  event.preventDefault()
                  if (draggingClipId && draggingClipId !== clip.id) {
                    reorderClips(draggingClipId, clip.id)
                  }
                  endDraggingClip()
                }}
                onDragEnd={endDraggingClip}
              >
                <div className='clip-content'>
                  <div className='clip-row'>
                    {editingClipId === clip.id
                      ? (
                        <input
                          className='clip-name-input'
                          autoFocus
                          value={editingClipName}
                          onChange={(event) => setEditingClipName(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              commitRenameClip(clip.id)
                            }
                            if (event.key === 'Escape') {
                              cancelRenameClip()
                            }
                          }}
                        />
                        )
                      : (
                        <button type='button' className='clip-name-btn' onClick={() => onOpenClip(clip.id)}>
                          <strong>{clip.name}</strong>
                        </button>
                        )}
                    <span className={`clip-status ${clipExportMap[clip.id]?.status ?? 'idle'}`} title={clipExportMap[clip.id]?.error ?? ''}>
                      {clipExportMap[clip.id]?.status ?? 'idle'}
                    </span>
                  </div>
                  <div className='clip-row'>
                    <button type='button' className='clip-time-btn' onClick={() => onOpenClip(clip.id)}>
                      <span className='clip-time-range'>
                        <span className='clip-time-part start'>{formatMs(clip.startMs)}</span>
                        <span className='clip-time-sep'>-</span>
                        <span className='clip-time-part end'>{formatMs(clip.endMs)}</span>
                      </span>
                      <span className='clip-time-part duration'>{formatMs(clip.durationMs)}</span>
                    </button>
                  </div>
                  <div className='clip-row clip-row-actions'>
                    <div className='clip-actions'>
                      {editingClipId === clip.id
                        ? (
                          <>
                            <button type='button' className='clip-save' onClick={() => commitRenameClip(clip.id)}>Save</button>
                            <button type='button' className='clip-cancel' onClick={cancelRenameClip}>Cancel</button>
                          </>
                          )
                        : (
                          <button type='button' className='clip-rename' onClick={() => beginRenameClip(clip)}>Rename</button>
                          )}
                      <button type='button' className='clip-delete' onClick={() => deleteClip(clip.id)}>Delete</button>
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
          )}

      {exportState !== 'idle' && (
        <p className='export-note'>
          {exportState === 'exporting' && `Exporting ${exportProgress.current}/${exportProgress.total} · ${exportProgress.clipName} · ${Math.round(exportProgress.clipProgress * 100)}%`}
          {exportState === 'done' && 'Export completed.'}
          {exportState === 'canceled' && 'Export canceled.'}
          {exportState === 'error' && 'Export completed with failures. Check clip list.'}
        </p>
      )}
    </section>
  )
}
