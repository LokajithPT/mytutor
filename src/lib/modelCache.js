import { openDB } from 'idb'

const DB_NAME = 'vosk-models'
const STORE = 'models'

// Cache the (large) model file in IndexedDB so it only downloads once,
// then works fully offline on subsequent loads.
export async function getCachedModelUrl(url) {
  const db = await openDB(DB_NAME, 1, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
    },
  })
  const cached = await db.get(STORE, url)
  if (cached) return URL.createObjectURL(new Blob([cached]))
  const resp = await fetch(url)
  if (!resp.ok) throw new Error(`model download failed: ${resp.status}`)
  const buf = await resp.arrayBuffer()
  await db.put(STORE, buf, url)
  return URL.createObjectURL(new Blob([buf]))
}
