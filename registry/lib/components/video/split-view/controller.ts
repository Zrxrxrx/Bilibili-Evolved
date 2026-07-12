import { childListSubtree, urlChange, videoChange } from '@/core/observer'
import { createDividerController, DividerController, SplitState } from './divider'
import {
  capturePlacement,
  CONFIG,
  isSupportedVideoUrl,
  Placement,
  queryUnique,
  resolveNodes,
  restoreManagedPayload,
  SELECTORS,
} from './dom'
import {
  observePlayerMode,
  observePlayerSize,
  SplitViewPlayerMode,
  waitForSplitViewPlayer,
} from './player'
import { createSplitViewShell } from './shell'

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

const resolveSessionNodes = async (signal: AbortSignal): Promise<SessionNodes | null> => {
  const resolvedPlayer = await waitForSplitViewPlayer(signal)
  if (!resolvedPlayer || signal.aborted) {
    return null
  }
  const resolvedNodes = resolveNodes(document)
  if (
    !resolvedNodes ||
    !(resolvedNodes.pageRoot instanceof HTMLElement) ||
    !(resolvedNodes.player instanceof HTMLElement) ||
    !resolvedNodes.player.contains(resolvedPlayer.container)
  ) {
    return null
  }
  return {
    author: resolvedNodes.author instanceof HTMLElement ? resolvedNodes.author : null,
    comments: resolvedNodes.comments instanceof HTMLElement ? resolvedNodes.comments : null,
    header: resolvedNodes.header instanceof HTMLElement ? resolvedNodes.header : null,
    media: resolvedPlayer.media,
    pageRoot: resolvedNodes.pageRoot,
    player: resolvedNodes.player,
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
  let authorPlacement: Placement<HTMLElement> | null = author ? capturePlacement(author) : null
  let commentsPlacement: Placement<HTMLElement> | null = comments
    ? capturePlacement(comments)
    : null
  const emptySources = new Set<HTMLElement>()
  const shell = createSplitViewShell()
  const sessionAbortController = new AbortController()
  let currentAuthor = author
  let currentComments = comments
  let stopped = false
  let nativeFullscreen = Boolean(document.fullscreenElement)
  let resizeFrame = 0
  let divider: DividerController | null = null
  let stopModeObserver = lodash.noop
  let stopSizeObserver = lodash.noop

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
      paneHeight > 0
        ? Math.max(sendingBarHeight, paneHeight - CONFIG.minLeftScrollHeight)
        : naturalHeight
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
      const nextAuthor = queryUnique(pageRoot, SELECTORS.author)
      if (nextAuthor instanceof HTMLElement) {
        attachAuthor(nextAuthor)
      }
    }
    if (!currentComments?.isConnected) {
      const nextComments = queryUnique(pageRoot, SELECTORS.comments)
      if (nextComments instanceof HTMLElement) {
        attachComments(nextComments)
      }
    }
  }

  const stop = () => {
    if (stopped) {
      return
    }
    stopped = true
    sessionAbortController.abort()
    if (resizeFrame !== 0) {
      cancelAnimationFrame(resizeFrame)
      resizeFrame = 0
    }
    divider?.stop()
    stopSizeObserver()
    stopModeObserver()
    header?.classList.remove('bsv-hidden')
    restoreManagedPayload(
      authorPlacement,
      [authorPlacement?.node],
      authorPlacement?.node ?? null,
      true,
      pageRoot,
    )
    restoreManagedPayload(
      commentsPlacement,
      [commentsPlacement?.node],
      commentsPlacement?.node ?? null,
      true,
      pageRoot,
    )
    restoreManagedPayload(playerPlacement, [player], player, true, pageRoot)
    restoreManagedPayload(pagePlacement, [pageRoot], pageRoot, true, document.body)
    emptySources.forEach(element => element.classList.remove('bsv-source-empty'))
    pageRoot.classList.remove('bsv-page-root')
    document.documentElement.classList.remove('bsv-active', 'bsv-dragging')
    shell.shell.remove()
  }

  try {
    const fixedHeader =
      (header &&
        (dq(header, '.bili-header__bar.mini-header, .mini-header') as HTMLElement | null)) ||
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

    divider = createDividerController(
      window,
      shell.shell,
      shell.divider,
      notifyResize,
      splitState,
      () => nativeFullscreen,
    )
    stopSizeObserver = observePlayerSize(shell.playerSlot, notifyResize)
    stopModeObserver = observePlayerMode(setPlayerMode, sessionAbortController.signal)
    const onFullscreenChange = () => {
      nativeFullscreen = Boolean(document.fullscreenElement)
      if (nativeFullscreen) {
        divider?.cancelDrag()
      } else {
        notifyResize()
      }
    }
    document.addEventListener('fullscreenchange', onFullscreenChange, {
      signal: sessionAbortController.signal,
    })
    media.addEventListener('loadedmetadata', notifyResize, {
      signal: sessionAbortController.signal,
    })
    media.addEventListener('resize', notifyResize, { signal: sessionAbortController.signal })
    signal.addEventListener('abort', stop, { once: true })
    notifyResize()
  } catch (error) {
    stop()
    throw error
  }

  return {
    attachDelayedNodes,
    isHealthy: () =>
      shell.shell.isConnected &&
      shell.playerSlot.contains(player) &&
      shell.leftScroll.contains(pageRoot) &&
      media.isConnected &&
      player.contains(media),
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
  let currentVideoId: string | null = null
  let reconcileGeneration = 0
  let reconcileTimer = 0
  let runId = 0
  let session: LayoutSession | null = null
  let mediaQuery: MediaQueryList | null = null
  let splitState: SplitState = { ratio: CONFIG.defaultLeftRatio }

  const stopSession = () => {
    session?.stop()
    session = null
  }

  const reconcile = async (
    activeRunId: number,
    generation: number,
    expectedVideoId: string | null,
  ) => {
    if (
      activeRunId !== runId ||
      generation !== reconcileGeneration ||
      abortController?.signal.aborted
    ) {
      return
    }
    if (!isSupportedVideoUrl(location.href) || !mediaQuery?.matches) {
      stopSession()
      return
    }
    if (session?.isHealthy()) {
      session.attachDelayedNodes()
      return
    }
    stopSession()
    const nodes = await resolveSessionNodes(abortController.signal)
    if (
      !nodes ||
      activeRunId !== runId ||
      generation !== reconcileGeneration ||
      abortController.signal.aborted ||
      !isSupportedVideoUrl(location.href) ||
      !mediaQuery?.matches ||
      currentVideoId !== expectedVideoId
    ) {
      return
    }
    session = createLayoutSession(nodes, splitState, abortController.signal)
  }

  const scheduleReconcile = () => {
    const activeRunId = runId
    const generation = ++reconcileGeneration
    const expectedVideoId = currentVideoId
    clearTimeout(reconcileTimer)
    reconcileTimer = window.setTimeout(() => {
      reconcile(activeRunId, generation, expectedVideoId).catch(error => {
        console.warn('[videoSplitView] reconcile failed', error)
      })
    }, CONFIG.reconcileDelayMs)
  }

  const stop = () => {
    runId++
    reconcileGeneration++
    abortController?.abort()
    abortController = null
    documentObserver?.disconnect()
    documentObserver = null
    clearTimeout(reconcileTimer)
    reconcileTimer = 0
    mediaQuery = null
    currentVideoId = null
    stopSession()
  }

  const start = () => {
    stop()
    const activeRunId = ++runId
    abortController = new AbortController()
    mediaQuery = matchMedia(`(min-width: ${CONFIG.minViewportWidth}px)`)
    mediaQuery.addEventListener('change', scheduleReconcile, { signal: abortController.signal })
    ;[documentObserver] = childListSubtree(document, scheduleReconcile)
    urlChange(scheduleReconcile, { signal: abortController.signal })
    videoChange(
      ({ aid, cid }) => {
        const nextVideoId = `${aid}:${cid}`
        if (currentVideoId !== null && currentVideoId !== nextVideoId) {
          splitState = { ratio: CONFIG.defaultLeftRatio }
          stopSession()
        }
        currentVideoId = nextVideoId
        scheduleReconcile()
      },
      { signal: abortController.signal },
    ).catch(error => {
      console.warn('[videoSplitView] video observer failed', error)
    })
    const generation = ++reconcileGeneration
    reconcile(activeRunId, generation, currentVideoId).catch(error => {
      console.warn('[videoSplitView] initial reconcile failed', error)
    })
  }

  return { start, stop }
}
