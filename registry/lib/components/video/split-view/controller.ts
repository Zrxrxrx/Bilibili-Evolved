import { childListSubtree, urlChange, videoChange } from '@/core/observer'
import type { PlayerMode } from '@/components/video/player-adaptor'
import { createDividerController, DividerController, SplitState } from './divider'
import {
  capturePlacement,
  collectAllManagedPageRoots,
  CONFIG,
  isSupportedVideoUrl,
  Placement,
  queryUnique,
  resolveNodes,
  resolveManagedPageRoot,
  resolveManagedSlotResult,
  restoreManagedPayload,
  SELECTORS,
  videoIdentity,
} from './dom'
import { observeElementSize, observePlayerMode, waitForSplitViewPlayer } from './player'
import { createSplitViewShell } from './shell'

interface SessionNodes {
  auxiliary: HTMLElement | null
  author: HTMLElement | null
  comments: HTMLElement | null
  header: HTMLElement | null
  media: HTMLElement
  pageRoot: HTMLElement
  player: HTMLElement
}

interface LayoutSession {
  attachDelayedNodes: () => void
  hasReplacementPageRoot: () => boolean
  isHealthy: () => boolean
  setRatio: (ratio: number) => void
  setMinRightWidth: (width: number) => void
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
    auxiliary: resolvedNodes.auxiliary instanceof HTMLElement ? resolvedNodes.auxiliary : null,
    author: resolvedNodes.author instanceof HTMLElement ? resolvedNodes.author : null,
    comments: resolvedNodes.comments instanceof HTMLElement ? resolvedNodes.comments : null,
    header: resolvedNodes.header instanceof HTMLElement ? resolvedNodes.header : null,
    media: resolvedPlayer.media,
    pageRoot: resolvedNodes.pageRoot,
    player: resolvedNodes.player,
  }
}

const resolveFixedHeader = (header: HTMLElement | null) =>
  (header && (dq(header, '.bili-header__bar.mini-header, .mini-header') as HTMLElement | null)) ||
  header

const createLayoutSession = (
  nodes: SessionNodes,
  splitState: SplitState,
  minRightWidth: number,
  onRatioCommitted: (ratio: number) => void,
  signal: AbortSignal,
): LayoutSession => {
  const { auxiliary, author, comments, header, media, pageRoot, player } = nodes
  const pagePlacement = capturePlacement(pageRoot)
  const playerPlacement = capturePlacement(player)
  let auxiliaryPlacement: Placement<HTMLElement> | null = auxiliary
    ? capturePlacement(auxiliary)
    : null
  let authorPlacement: Placement<HTMLElement> | null = author ? capturePlacement(author) : null
  let commentsPlacement: Placement<HTMLElement> | null = comments
    ? capturePlacement(comments)
    : null
  const emptySources = new Set<HTMLElement>()
  const shell = createSplitViewShell()
  const sessionAbortController = new AbortController()
  const rootHadActive = document.documentElement.classList.contains('bsv-active')
  const pageHadClass = pageRoot.classList.contains('bsv-page-root')
  let currentHeader = header
  let fixedHeader = resolveFixedHeader(header)
  let headerHadHidden = header?.classList.contains('bsv-hidden') ?? false
  let currentAuthor = author
  let currentComments = comments
  let currentAuxiliary = auxiliary
  let stopped = false
  let nativeFullscreen = Boolean(document.fullscreenElement)
  let webFullscreen = false
  let resizeFrame = 0
  let divider: DividerController | null = null
  let stopHeaderSizeObserver = lodash.noop
  let stopModeObserver = lodash.noop
  let stopSizeObserver = lodash.noop

  const markEmpty = (element: HTMLElement | null) => {
    if (
      element &&
      element.childElementCount === 0 &&
      !element.classList.contains('bsv-source-empty')
    ) {
      emptySources.add(element)
      element.classList.add('bsv-source-empty')
    }
  }

  const syncPlayerSize = () => {
    const { width } = player.getBoundingClientRect()
    if (!media.isConnected || width <= 0) {
      return
    }
    const mediaWithDimensions = media as HTMLElement & {
      videoHeight?: number
      videoWidth?: number
    }
    const { videoHeight = 0, videoWidth = 0 } = mediaWithDimensions
    const ratio = videoWidth > 0 && videoHeight > 0 ? videoWidth / videoHeight : 16 / 9
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

  const syncHeaderOffset = () => {
    const activeFixedHeader = fixedHeader?.isConnected
      ? fixedHeader
      : resolveFixedHeader(queryUnique(document, SELECTORS.header) as HTMLElement | null)
    const headerBottom = activeFixedHeader?.getBoundingClientRect().bottom ?? 0
    shell.shell.style.setProperty('--bsv-top-offset', `${Math.max(0, headerBottom)}px`)
  }

  const notifyResize = () => {
    if (stopped || nativeFullscreen || resizeFrame !== 0) {
      return
    }
    resizeFrame = requestAnimationFrame(() => {
      syncHeaderOffset()
      syncPlayerSize()
      window.dispatchEvent(new Event('resize'))
      resizeFrame = 0
    })
  }

  const setPlayerMode = (mode: PlayerMode) => {
    webFullscreen = mode === 'web'
    const wideScreen = mode === 'wide'
    nativeFullscreen = mode === 'full' || Boolean(document.fullscreenElement)
    shell.shell.classList.toggle('bsv-player-expanded', webFullscreen)
    shell.shell.classList.toggle('bsv-player-wide', wideScreen)
    if (currentHeader && !headerHadHidden) {
      currentHeader.classList.toggle('bsv-hidden', webFullscreen)
    }
    notifyResize()
  }

  const updateHeaderTarget = () => {
    const nextHeader = queryUnique(document, SELECTORS.header) as HTMLElement | null
    const nextFixedHeader = resolveFixedHeader(nextHeader)
    if (nextHeader === currentHeader && nextFixedHeader === fixedHeader) {
      return
    }
    if (currentHeader && !headerHadHidden) {
      currentHeader.classList.remove('bsv-hidden')
    }
    stopHeaderSizeObserver()
    currentHeader = nextHeader
    fixedHeader = nextFixedHeader
    headerHadHidden = currentHeader?.classList.contains('bsv-hidden') ?? false
    if (currentHeader && !headerHadHidden) {
      currentHeader.classList.toggle('bsv-hidden', webFullscreen)
    }
    stopHeaderSizeObserver = fixedHeader
      ? observeElementSize(fixedHeader, notifyResize)
      : lodash.noop
    notifyResize()
  }

  const hasReplacementPageRoot = () => {
    const pageSource = pagePlacement?.parent
    if (!(pageSource instanceof Element) || !pageSource.isConnected) {
      return false
    }
    return collectAllManagedPageRoots(pageSource).some(
      candidate =>
        !shell.shell.contains(candidate) &&
        candidate !== pageRoot &&
        !candidate.contains(pageRoot) &&
        !pageRoot.contains(candidate),
    )
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

  const attachAuxiliary = (node: HTMLElement) => {
    if (currentAuxiliary && shell.auxiliaryScroll.contains(currentAuxiliary)) {
      return
    }
    auxiliaryPlacement = capturePlacement(node)
    currentAuxiliary = node
    shell.auxiliaryScroll.replaceChildren(node)
    markEmpty(auxiliaryPlacement.parent as HTMLElement)
  }

  const attachDelayedNodes = () => {
    updateHeaderTarget()
    if (!currentAuthor?.isConnected) {
      const nextAuthor =
        queryUnique(shell.auxiliaryScroll, SELECTORS.author) ||
        queryUnique(pageRoot, SELECTORS.author)
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
    if (!currentAuxiliary || !shell.auxiliaryScroll.contains(currentAuxiliary)) {
      const nextAuxiliary = queryUnique(pageRoot, SELECTORS.auxiliary)
      if (nextAuxiliary instanceof HTMLElement) {
        attachAuxiliary(nextAuxiliary)
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
    stopHeaderSizeObserver()
    stopSizeObserver()
    stopModeObserver()
    const replacementPageRootExists = hasReplacementPageRoot()
    const pagePayload = [...shell.leftScroll.children]
    const playerPayload = [...shell.playerSlot.children]
    const commentsPayload = [...shell.commentsScroll.children].filter(
      node => node !== shell.commentsWaiting,
    )
    const auxiliaryPayload = [...shell.auxiliaryScroll.children].filter(
      node => node !== shell.auxiliaryWaiting,
    )
    const authorPayload = [...shell.authorCard.children]
    const managedPageRoot = resolveManagedPageRoot(shell.leftScroll, pageRoot)
    const managedPlayer = resolveManagedSlotResult(shell.playerSlot, SELECTORS.player, player).node
    const managedComments = resolveManagedSlotResult(
      shell.commentsScroll,
      SELECTORS.comments,
      currentComments,
      'bsv-comments-waiting',
    ).node
    const managedAuthor = resolveManagedSlotResult(
      shell.authorCard,
      SELECTORS.author,
      currentAuthor,
    ).node
    const managedAuxiliary = resolveManagedSlotResult(
      shell.auxiliaryScroll,
      SELECTORS.auxiliary,
      currentAuxiliary,
      'bsv-auxiliary-waiting',
    ).node
    const cleanupTasks: Array<() => void> = [
      () => shell.commentsWaiting.remove(),
      () => shell.auxiliaryWaiting.remove(),
      () => {
        if (!replacementPageRootExists) {
          restoreManagedPayload(authorPlacement, authorPayload, managedAuthor, true, pageRoot)
          restoreManagedPayload(
            auxiliaryPlacement,
            auxiliaryPayload,
            managedAuxiliary,
            true,
            pageRoot,
          )
          restoreManagedPayload(commentsPlacement, commentsPayload, managedComments, true, pageRoot)
          restoreManagedPayload(playerPlacement, playerPayload, managedPlayer, true, pageRoot)
          restoreManagedPayload(pagePlacement, pagePayload, managedPageRoot, true, document.body)
        }
      },
      () => emptySources.forEach(element => element.classList.remove('bsv-source-empty')),
      () => {
        if (!pageHadClass) {
          pageRoot.classList.remove('bsv-page-root')
        }
      },
      () => {
        if (!rootHadActive) {
          document.documentElement.classList.remove('bsv-active')
        }
        document.documentElement.classList.remove('bsv-dragging')
      },
      () => {
        if (currentHeader && !headerHadHidden) {
          currentHeader.classList.remove('bsv-hidden')
        }
      },
      () => shell.shell.remove(),
    ]
    cleanupTasks.forEach(task => {
      try {
        task()
      } catch (error) {
        console.warn('[videoSplitView] layout cleanup failed', error)
      }
    })
  }

  try {
    syncHeaderOffset()
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
    if (auxiliary) {
      shell.auxiliaryScroll.replaceChildren(auxiliary)
      markEmpty(auxiliaryPlacement?.parent as HTMLElement)
    }

    divider = createDividerController(
      window,
      shell.shell,
      shell.divider,
      notifyResize,
      minRightWidth,
      splitState,
      () => nativeFullscreen,
      onRatioCommitted,
    )
    if (fixedHeader) {
      stopHeaderSizeObserver = observeElementSize(fixedHeader, notifyResize)
    }
    stopSizeObserver = observeElementSize(shell.playerSlot, notifyResize)
    stopModeObserver = observePlayerMode(setPlayerMode, sessionAbortController.signal)
    const onFullscreenChange = () => {
      nativeFullscreen = Boolean(document.fullscreenElement)
      if (nativeFullscreen) {
        divider?.cancelDrag()
      } else {
        divider?.applyRatio()
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
    hasReplacementPageRoot,
    isHealthy: () =>
      shell.shell.isConnected &&
      shell.playerSlot.contains(player) &&
      shell.leftScroll.contains(pageRoot) &&
      media.isConnected &&
      player.contains(media),
    setRatio: ratio => {
      divider?.cancelDrag()
      divider?.setRatio(ratio)
    },
    setMinRightWidth: width => divider?.setMinRightWidth(width),
    stop,
  }
}

export interface SplitViewController {
  setMinRightWidth: (width: number) => void
  start: () => void
  stop: () => void
}

export type SplitOrientation = 'landscape' | 'portrait'

export interface SplitRatios {
  landscape: number
  portrait: number
}

interface SplitViewControllerOptions {
  minRightWidth: number
  ratios: SplitRatios
  onRatioCommitted: (orientation: SplitOrientation, ratio: number) => void
}

const normalizeRatio = (ratio: number) =>
  Number.isFinite(ratio) ? lodash.clamp(ratio, CONFIG.minLeftRatio, 1) : CONFIG.defaultLeftRatio

const getOrientation = (): SplitOrientation =>
  window.matchMedia('(orientation: portrait)').matches ? 'portrait' : 'landscape'

export const createSplitViewController = ({
  minRightWidth,
  ratios,
  onRatioCommitted,
}: SplitViewControllerOptions): SplitViewController => {
  let abortController: AbortController | null = null
  let documentObserver: MutationObserver | null = null
  let currentVideoId: string | null = null
  let reconcileGeneration = 0
  let reconcileTimer = 0
  let runId = 0
  let scheduleReconcile: () => void = lodash.noop
  let session: LayoutSession | null = null
  let mediaQuery: MediaQueryList | null = null
  let orientationMediaQuery: MediaQueryList | null = null
  let pendingCommentProbe: { frame: number; href: string; x: number; y: number } | null = null
  let probedVideo: string | null = null
  let currentMinRightWidth = minRightWidth
  let currentOrientation = getOrientation()
  const splitState: SplitState = { ratio: normalizeRatio(ratios[currentOrientation]) }

  const commitRatio = (ratio: number) => {
    const normalizedRatio = normalizeRatio(ratio)
    splitState.ratio = normalizedRatio
    ratios[currentOrientation] = normalizedRatio
    onRatioCommitted(currentOrientation, normalizedRatio)
  }

  const setOrientation = (orientation: SplitOrientation) => {
    if (currentOrientation === orientation) {
      return
    }
    currentOrientation = orientation
    splitState.ratio = normalizeRatio(ratios[currentOrientation])
    session?.setRatio(splitState.ratio)
  }

  const stopSession = () => {
    session?.stop()
    session = null
  }

  const cancelCommentProbe = (restoreScroll: boolean) => {
    const probe = pendingCommentProbe
    if (!probe) {
      return
    }
    pendingCommentProbe = null
    cancelAnimationFrame(probe.frame)
    if (restoreScroll && location.href === probe.href) {
      scrollTo(probe.x, probe.y)
    }
  }

  const maybeProbeComments = (nodes: SessionNodes) => {
    const identity = currentVideoId ?? videoIdentity(location.href)
    if (nodes.comments || !identity || probedVideo === identity) {
      return false
    }
    const anchor = queryUnique(nodes.pageRoot, SELECTORS.commentAnchor)
    if (!(anchor instanceof HTMLElement)) {
      return false
    }
    probedVideo = identity
    const probe = {
      frame: 0,
      href: location.href,
      x: scrollX,
      y: scrollY,
    }
    anchor.scrollIntoView({ block: 'center' })
    probe.frame = requestAnimationFrame(() => {
      if (pendingCommentProbe !== probe) {
        return
      }
      pendingCommentProbe = null
      if (location.href === probe.href) {
        scrollTo(probe.x, probe.y)
        scheduleReconcile()
      }
    })
    pendingCommentProbe = probe
    return true
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
      cancelCommentProbe(true)
      stopSession()
      return
    }
    if (session?.hasReplacementPageRoot()) {
      stopSession()
    } else if (session?.isHealthy()) {
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
    if (maybeProbeComments(nodes)) {
      return
    }
    session = createLayoutSession(
      nodes,
      splitState,
      currentMinRightWidth,
      commitRatio,
      abortController.signal,
    )
  }

  scheduleReconcile = () => {
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
    orientationMediaQuery = null
    currentVideoId = null
    probedVideo = null
    cancelCommentProbe(true)
    stopSession()
  }

  const start = () => {
    stop()
    const activeRunId = ++runId
    abortController = new AbortController()
    mediaQuery = window.matchMedia(`(min-width: ${CONFIG.minViewportWidth}px)`)
    orientationMediaQuery = window.matchMedia('(orientation: portrait)')
    currentOrientation = orientationMediaQuery.matches ? 'portrait' : 'landscape'
    splitState.ratio = normalizeRatio(ratios[currentOrientation])
    mediaQuery.addEventListener('change', scheduleReconcile, { signal: abortController.signal })
    orientationMediaQuery.addEventListener(
      'change',
      event => setOrientation(event.matches ? 'portrait' : 'landscape'),
      { signal: abortController.signal },
    )
    ;[documentObserver] = childListSubtree(document, scheduleReconcile)
    urlChange(scheduleReconcile, { signal: abortController.signal })
    videoChange(
      ({ aid, cid }) => {
        const nextVideoId = `${aid}:${cid}`
        if (currentVideoId !== null && currentVideoId !== nextVideoId) {
          cancelCommentProbe(false)
          probedVideo = null
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

  const setMinRightWidth = (width: number) => {
    currentMinRightWidth = width
    session?.setMinRightWidth(width)
  }

  return { setMinRightWidth, start, stop }
}
