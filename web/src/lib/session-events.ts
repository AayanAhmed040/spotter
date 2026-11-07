/** Tiny pub/sub so non-React code (the query cache) can flag an expired session. */
type Listener = (expired: boolean) => void
const listeners = new Set<Listener>()
let expired = false

export const sessionEvents = {
  expire() {
    if (expired) return
    expired = true
    listeners.forEach((l) => l(true))
  },
  reset() {
    expired = false
    listeners.forEach((l) => l(false))
  },
  subscribe(l: Listener) {
    listeners.add(l)
    l(expired)
    return () => {
      listeners.delete(l)
    }
  },
}
