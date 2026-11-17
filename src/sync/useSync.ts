import { useSyncExternalStore } from 'react'
import { syncStore } from './engine'

export function useSyncState() {
  return useSyncExternalStore(syncStore.subscribe, syncStore.get)
}
