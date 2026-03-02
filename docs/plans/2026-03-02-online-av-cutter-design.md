# Online AV Cutter Design (V1)

Date: 2026-03-02
Project: fabulous-cutter
Status: Approved for planning

## 1. Goals and Scope

V1 goal is a browser-based audio/video cutter with two tabs and identical editing behavior:

1. `Video` tab
2. `Audio` tab

Core scope:

1. Single input file per editing session.
2. A high-quality left/right trim handle interaction for clip start/end.
3. Add multiple clips from the current trim range.
4. Export each clip as a separate output file.
5. Entire workflow runs locally in browser (no upload).
6. Use `mediabunny` for clip export.

Out of scope in V1:

1. Timeline/multitrack editing
2. Transitions, subtitles, filters
3. Backend processing
4. Project persistence/reopen

## 2. UX and Interaction Design

### 2.1 Editor Layout

1. Top-level tabs: `Video` and `Audio`.
2. Main area: media player (`<video>` or `<audio>`).
3. Timeline area: time ruler + current range highlight.
4. Clip actions: `Add Clip`, `Export All`, optional `Cancel Export`.
5. Clip list: name, start, end, duration, actions (`rename`, `delete`, `jump/edit`).

### 2.2 Trim Range Interaction (Primary UX)

The trimming control uses a single active range `[start, end]`:

1. Left handle adjusts `start`.
2. Right handle adjusts `end`.
3. Dragging range body moves both edges together, preserving duration.

Interaction quality rules:

1. Real-time preview while dragging (player time follows active edge/mode).
2. Snap behavior near key points:
   - `0`
   - `duration`
   - playhead
3. Minimum duration guard (e.g. `100ms`) to prevent invalid ranges.
4. Edge damping at boundaries for better feel.
5. Keyboard fine tuning:
   - arrow: `+-10ms`
   - shift+arrow: `+-100ms`

### 2.3 Clip Creation and Editing

1. `Add Clip` snapshots current `[start, end]` into clip list.
2. Default naming: `clip-001`, `clip-002`, ...
3. Clicking a clip restores it into active range for adjustment.
4. Users can rename and delete clips.

## 3. Architecture and Data Flow

### 3.1 Component/Module Breakdown

1. `EditorPage`
   - tab switching
   - file import
   - export orchestration
2. `MediaPlayer`
   - render player
   - playback controls
   - currentTime sync
3. `TrimRange`
   - drag logic
   - snap and constraints
   - keyboard interaction
4. `ClipList`
   - list render and CRUD actions
5. `exportService`
   - wraps `mediabunny` export by clip
   - reports progress and errors
6. `timeUtils`
   - conversion and formatting helpers

### 3.2 Session State Model

```ts
type MediaType = 'video' | 'audio'

type Clip = {
  id: string
  name: string
  startMs: number
  endMs: number
  durationMs: number
}

type EditorState = {
  sourceFile: File | null
  mediaType: MediaType
  durationMs: number
  activeRange: { startMs: number; endMs: number }
  clips: Clip[]
  exportState: 'idle' | 'exporting' | 'done' | 'error'
}
```

### 3.3 Data Flow

1. Import file -> parse duration -> initialize `activeRange`.
2. Drag in `TrimRange` -> update `activeRange` -> sync preview.
3. `Add Clip` -> append snapshot to `clips`.
4. `Export All` -> iterate `clips` -> `mediabunny` exports each segment -> user downloads multiple files.

## 4. Export Strategy (mediabunny)

1. Input is original source file and clip boundaries.
2. Output is one file per clip.
3. Naming pattern: `<original-base>_<clip-name>.<ext>`.
4. Use serial queue in V1 to reduce memory pressure.
5. Progress shows `current / total`.
6. Cancellation stops pending queue items.
7. Failed items are marked and can be retried.

## 5. Validation, Errors, and Recovery

Validation rules:

1. Reject unsupported file formats with clear message.
2. Disable add/export for invalid ranges.
3. Enforce `startMs < endMs`.
4. Enforce minimum clip duration.

Failure handling:

1. Parse/decode failures: show actionable error.
2. Export failure per clip: keep successful outputs, mark failed clips.
3. Cancel export: preserve completed clips and restore UI to editable state.

## 6. Testing Strategy

Unit tests:

1. Time conversion (`ms <-> px`) and formatting.
2. Range validation and min-duration logic.
3. Snap and clamp behavior.

Component tests:

1. Handle dragging updates `activeRange`.
2. Clip add/rename/delete behavior.
3. Clip selection restores active range.

Integration tests:

1. Import -> create multiple clips -> export multiple files.
2. Export cancellation flow.
3. Partial export failure and retry path.

## 7. Milestones

1. M1: player + trim range interaction quality
2. M2: clip list CRUD + restore-to-edit flow
3. M3: `mediabunny` serial export + progress + retry/cancel
4. M4: polish (keyboard tuning, snap thresholds, error UX)

## 8. Accepted Product Decisions

1. Two tabs (`video`, `audio`) with same editing model.
2. Primary UX is left/right trim handles with strong drag feel.
3. Multiple clips are exported as separate files (not concatenated).
4. Entire processing is local in browser.
5. `mediabunny` is the export engine.
