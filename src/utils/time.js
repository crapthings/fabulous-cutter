export function formatMs (value) {
  const totalMs = Math.max(0, Math.round(value))
  const ms = String(totalMs % 1000).padStart(3, '0')
  const totalSeconds = Math.floor(totalMs / 1000)
  const seconds = String(totalSeconds % 60).padStart(2, '0')
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, '0')
  return `${minutes}:${seconds}.${ms}`
}
