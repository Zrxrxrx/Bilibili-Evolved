import { childListSubtree, urlChange, videoChange } from '@/core/observer'
import { createDividerController, SplitState } from './divider'
import {
  observePlayerMode,
  observePlayerSize,
  SplitViewPlayerMode,
  waitForSplitViewPlayer,
} from './player'
import { createSplitViewShell } from './shell'

const minViewportWidth = 960
const minLeftScrollHeight = 180
const reconcileDelay = 50

interface Placement {
  nextSibling: ChildNode | null
  node: HTMLElement
  parent: Node
}

interface SessionNodes {
  author: HTMLElement | null
  comments: HTMLElement | null
  header: HTMLElement | null
  media: HTMLVideoElement
  pageRoot: HTMLElement
  player: HTMLElement
}

interface LayoutSession {
  attachDelayedNodes: () => void
  isHealthy: () => boolean
  stop: () => void
}

const isSupportedPage = (href = location.href) => {
  try {
    const url = new URL(href)
    return (
      url.protocol === 'https:' &&
      url.host === 'www.bilibili.com' &&
      url.pathname.startsWith('/video/')
    )
  } catch {
    return false
  }
}

const queryByPriority = (scope: ParentNode, selectors: string[]) => {
  for (const selector of selectors) {
    const matches = Array.from(scope.querySelectorAll(selector)).filter(
      (node): node is HTMLElement => node instanceof HTMLElement,
    )
    if (matches.length === 1) {
      return matches[0]
    }
    if (matches.length > 1) {
      return null
    }
  }
  return null
}

const capturePlacement = (node: HTMLElement): Placement => ({
  nextSibling: node.nextSibling,
  node,
  parent: node.parentNode,
})

const restorePlacement = (placement: Placement | null, fallback: Node) => {
  if (!placement || !placement.node.isConnected) {
    return
  }
  const parent = placement.parent.isConnected ? placement.parent : fallback
  const sibling = placement.nextSibling?.parentNode === parent ? placement.nextSibling : null
  parent.insertBefore(placement.node, sibling)
}

const resolveSessionNodes = async (signal: AbortSignal): Promise<SessionNodes | null> => {
  const resolvedPlayer = await waitForSplitViewPlayer(signal)
  if (!resolvedPlayer || signal.aborted) {
    return null
  }
  const { container, media } = resolvedPlayer
  const player = container.closest('.video-container-v1') || container
  if (!(player instanceof HTMLElement)) {
    return null
  }
  const pageRoot =
    player.closest('.video-page-v1') ||
    player.closest('main') ||
    (dq('#app .video-page-v1, #app main, #app') as HTMLElement | null)
  if (!(pageRoot instanceof HTMLElement)) {
    return null
  }
  return {
    author: queryByPriority(pageRoot, ['.up-panel-container']),
    comments: queryByPriority(pageRoot, ['#commentapp', '#comment', '.comment-container']),
    header: queryByPriority(document, ['#biliMainHeader', '.bili-header', '.mini-header']),
    media,
    pageRoot,
    player,
  }
}

const createLayoutSession = (
  nodes: SessionNodes,
  splitState: SplitState,
  signal: AbortSignal,
): LayoutSession => {
  const { author, comments, header, media, pageRoot, player } = nodes
  const pagePlacement = capturePlacement(pageRoot)
  const playerPlacement = capturePlacement(player)
  let authorPlacement = author ? capturePlacement(author) : null
  let commentsPlacement = comments ? capturePlacement(comments) : null
  const emptySources = new Set<HTMLElement>()
  const shell = createSplitViewShell()
  let currentAuthor = author
  let currentComments = comments
  let stopped = false
  let nativeFullscreen = Boolean(document.fullscreenElement)
  let resizeFrame = 0

  const markEmpty = (element: HTMLElement | null) => {
    if (element && element.childElementCount === 0) {
      emptySources.add(element)
      element.classList.add('bsv-source-empty')
    }
  }

  const syncPlayerSize = () => {
    const { width } = player.getBoundingClientRect()
    if (!media.isConnected || width <= 0) {
      return
    }
    const ratio =
      media.videoWidth > 0 && media.videoHeight > 0 ? media.videoWidth / media.videoHeight : 16 / 9
    const sendingBarHeight =
      (dq(player, '.bpx-player-sending-bar') as HTMLElement | null)?.getBoundingClientRect()
        .height ?? 0
    const naturalHeight = width / ratio + sendingBarHeight
    const paneHeight = shell.leftPane.getBoundingClientRect().height
    const maxHeight =
      paneHeight > 0 ? Math.max(sendingBarHeight, paneHeight - minLeftScrollHeight) : naturalHeight
    shell.shell.style.setProperty('--bsv-player-height', `${Math.min(naturalHeight, maxHeight)}px`)
  }

  const notifyResize = () => {
    if (stopped || nativeFullscreen || resizeFrame !== 0) {
      return
    }
    resizeFrame = requestAnimationFrame(() => {
      syncPlayerSize()
      window.dispatchEvent(new Event('resize'))
      resizeFrame = 0
    })
  }

  const setPlayerMode = (mode: SplitViewPlayerMode) => {
    const webFullscreen = mode === SplitViewPlayerMode.WebFullscreen
    const wideScreen = mode === SplitViewPlayerMode.WideScreen
    nativeFullscreen =
      mode === SplitViewPlayerMode.Fullscreen || Boolean(document.fullscreenElement)
    shell.shell.classList.toggle('bsv-player-expanded', webFullscreen)
    shell.shell.classList.toggle('bsv-player-wide', wideScreen)
    header?.classList.toggle('bsv-hidden', webFullscreen)
    notifyResize()
  }

  const attachAuthor = (node: HTMLElement) => {
    if (currentAuthor && shell.authorCard.contains(currentAuthor)) {
      return
    }
    authorPlacement = capturePlacement(node)
    currentAuthor = node
    shell.authorCard.replaceChildren(node)
    markEmpty(authorPlacement.parent as HTMLElement)
  }

  const attachComments = (node: HTMLElement) => {
    if (currentComments && shell.commentsScroll.contains(currentComments)) {
      return
    }
    commentsPlacement = capturePlacement(node)
    currentComments = node
    shell.commentsScroll.replaceChildren(node)
    markEmpty(commentsPlacement.parent as HTMLElement)
  }

  const attachDelayedNodes = () => {
    if (!currentAuthor?.isConnected) {
      const nextAuthor = queryByPriority(pageRoot, ['.up-panel-container'])
      if (nextAuthor) {
        attachAuthor(nextAuthor)
      }
    }
    if (!currentComments?.isConnected) {
      const nextComments = queryByPriority(pageRoot, [
        '#commentapp',
        '#comment',
        '.comment-container',
      ])
      if (nextComments) {
        attachComments(nextComments)
      }
    }
  }

  const fixedHeader =
    (header && (dq(header, '.bili-header__bar.mini-header, .mini-header') as HTMLElement | null)) ||
    header
  const headerBottom = fixedHeader?.getBoundingClientRect().bottom ?? 0
  shell.shell.style.setProperty('--bsv-top-offset', `${Math.max(0, headerBottom)}px`)
  document.documentElement.classList.add('bsv-active')
  pageRoot.classList.add('bsv-page-root')
  shell.leftScroll.append(pageRoot)
  shell.playerSlot.append(player)
  markEmpty(playerPlacement.parent as HTMLElement)
  if (author) {
    shell.authorCard.replaceChildren(author)
    markEmpty(authorPlacement?.parent as HTMLElement)
  }
  if (comments) {
    shell.commentsScroll.replaceChildren(comments)
    markEmpty(commentsPlacement?.parent as HTMLElement)
  }

  const divider = createDividerController(
    window,
    shell.shell,
    shell.divider,
    notifyResize,
    splitState,
    () => nativeFullscreen,
  )
  const stopSizeObserver = observePlayerSize(shell.playerSlot, notifyResize)
  const stopModeObserver = observePlayerMode(setPlayerMode, signal)
  const onFullscreenChange = () => {
    nativeFullscreen = Boolean(document.fullscreenElement)
    if (nativeFullscreen) {
      divider.cancelDrag()
    } else {
      notifyResize()
    }
  }
  document.addEventListener('fullscreenchange', onFullscreenChange, { signal })
  media.addEventListener('loadedmetadata', notifyResize, { signal })
  media.addEventListener('resize', notifyResize, { signal })
  notifyResize()

  const stop = () => {
    if (stopped) {
      return
    }
    stopped = true
    if (resizeFrame !== 0) {
      cancelAnimationFrame(resizeFrame)
      resizeFrame = 0
    }
    divider.stop()
    stopSizeObserver()
    stopModeObserver()
    header?.classList.remove('bsv-hidden')
    restorePlacement(authorPlacement, pageRoot)
    restorePlacement(commentsPlacement, pageRoot)
    restorePlacement(playerPlacement, pageRoot)
    restorePlacement(pagePlacement, document.body)
    emptySources.forEach(element => element.classList.remove('bsv-source-empty'))
    pageRoot.classList.remove('bsv-page-root')
    document.documentElement.classList.remove('bsv-active', 'bsv-dragging')
    shell.shell.remove()
  }

  return {
    attachDelayedNodes,
    isHealthy: () =>
      shell.shell.isConnected &&
      shell.playerSlot.contains(player) &&
      shell.leftScroll.contains(pageRoot),
    stop,
  }
}

export interface SplitViewController {
  start: () => void
  stop: () => void
}

export const createSplitViewController = (): SplitViewController => {
  let abortController: AbortController | null = null
  let documentObserver: MutationObserver | null = null
  let reconcileTimer = 0
  let runId = 0
  let session: LayoutSession | null = null
  let mediaQuery: MediaQueryList | null = null
  let splitState: SplitState = { ratio: 0.64 }

  const stopSession = () => {
    session?.stop()
    session = null
  }

  const reconcile = async (activeRunId: number) => {
    if (activeRunId !== runId || abortController?.signal.aborted) {
      return
    }
    if (!isSupportedPage() || !mediaQuery?.matches) {
      stopSession()
      return
    }
    if (session?.isHealthy()) {
      session.attachDelayedNodes()
      return
    }
    stopSession()
    const nodes = await resolveSessionNodes(abortController.signal)
    if (!nodes || activeRunId !== runId || abortController.signal.aborted) {
      return
    }
    session = createLayoutSession(nodes, splitState, abortController.signal)
  }

  const scheduleReconcile = () => {
    const activeRunId = runId
    clearTimeout(reconcileTimer)
    reconcileTimer = window.setTimeout(() => {
      reconcile(activeRunId).catch(error => {
        console.warn('[videoSplitView] reconcile failed', error)
      })
    }, reconcileDelay)
  }

  const stop = () => {
    runId++
    abortController?.abort()
    abortController = null
    documentObserver?.disconnect()
    documentObserver = null
    clearTimeout(reconcileTimer)
    reconcileTimer = 0
    mediaQuery = null
    stopSession()
  }

  const start = () => {
    stop()
    const activeRunId = ++runId
    abortController = new AbortController()
    mediaQuery = matchMedia(`(min-width: ${minViewportWidth}px)`)
    mediaQuery.addEventListener('change', scheduleReconcile, { signal: abortController.signal })
    ;[documentObserver] = childListSubtree(document, scheduleReconcile)
    urlChange(scheduleReconcile, { signal: abortController.signal })
    videoChange(
      () => {
        splitState = { ratio: 0.64 }
        scheduleReconcile()
      },
      { signal: abortController.signal },
    ).catch(error => {
      console.warn('[videoSplitView] video observer failed', error)
    })
    reconcile(activeRunId).catch(error => {
      console.warn('[videoSplitView] initial reconcile failed', error)
    })
  }

  return { start, stop }
}
