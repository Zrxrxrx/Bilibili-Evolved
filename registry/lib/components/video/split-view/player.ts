import { playerAgent } from '@/components/video/player-agent'
import { sizeChange } from '@/core/observer'
import { playerReady } from '@/core/utils'

export enum SplitViewPlayerMode {
  Normal = 'normal',
  WideScreen = 'wide',
  WebFullscreen = 'web',
  Fullscreen = 'full',
  Mini = 'mini',
}

export interface SplitViewPlayer {
  container: HTMLElement
  media: HTMLElement
}

const readPlayerMode = () => {
  const container = dq('.bpx-player-container') as HTMLElement | null
  const mode = container?.dataset.screen as SplitViewPlayerMode | undefined
  return Object.values(SplitViewPlayerMode).includes(mode) ? mode : SplitViewPlayerMode.Normal
}

export const waitForSplitViewPlayer = async (
  signal?: AbortSignal,
): Promise<SplitViewPlayer | null> => {
  await playerReady()
  if (signal?.aborted) {
    return null
  }
  const [container, media] = await Promise.all([
    playerAgent.query.bilibiliPlayer(),
    playerAgent.query.video.element(),
  ])
  if (signal?.aborted || !(container instanceof HTMLElement) || !(media instanceof HTMLElement)) {
    return null
  }
  return {
    container,
    media,
  }
}

export const observePlayerMode = (
  callback: (mode: SplitViewPlayerMode) => void,
  signal?: AbortSignal,
) => {
  const handler = (event: CustomEvent<{ mode: SplitViewPlayerMode }>) => callback(event.detail.mode)
  callback(readPlayerMode())
  window.addEventListener('playerModeChange', handler as EventListener, { signal })
  return () => window.removeEventListener('playerModeChange', handler as EventListener)
}

export const observePlayerSize = (target: Element, callback: () => void) => {
  const [observer] = sizeChange(target, callback)
  return () => observer.disconnect()
}
