export const CONFIG = Object.freeze({
  minViewportWidth: 960,
  defaultLeftRatio: 0.64,
  minLeftRatio: 0.42,
  maxLeftRatio: 0.72,
  minLeftWidth: 420,
  minRightWidth: 320,
  dividerWidth: 10,
  minLeftScrollHeight: 180,
  reconcileDelayMs: 50,
})

export const SELECTORS = Object.freeze({
  header: ['#biliMainHeader', '.bili-header', '.mini-header'],
  pageRoot: ['.bsv-page-root', '#app .video-page-v1', '#app main', '#app'],
  player: ['#bilibili-player', '.bpx-player-container', '.video-container-v1'],
  comments: ['#commentapp', '#comment', '.comment-container'],
  author: ['.up-panel-container'],
  commentAnchor: ['#commentapp', '#comment', '[data-module="comment"]'],
})

export const MANAGED_PAGE_ROOT_SELECTORS = Object.freeze([
  '.bsv-page-root',
  '.video-page-v1',
  'main',
  '#app',
])

type QueryScope = Document | DocumentFragment | Element
type ManagedParent = Node & ParentNode

export interface UniqueResult {
  ambiguous: boolean
  node: Element | null
}

export interface Placement<T extends Element = Element> {
  node: T
  parent: ManagedParent | null
  nextSibling: ChildNode | null
  style: string | null
}

export interface ManagedNodesHint {
  author?: Element | null
  comments?: Element | null
  commentsSource?: Element | null
  header?: Element | null
  initialPageElements?: WeakSet<Element> | null
  pageRoot?: Element | null
  pageSource?: Element | null
  player?: Element | null
  playerSource?: Element | null
}

export interface ResolvedNodes {
  pageRoot: Element
  player: Element
  comments: Element | null
  author: Element | null
  header: Element | null
}

export const isSupportedVideoUrl = (href: string) => {
  try {
    const url = new URL(href)
    return (
      url.protocol === 'https:' &&
      url.hostname === 'www.bilibili.com' &&
      /^\/video\/[^/]+\/?$/.test(url.pathname)
    )
  } catch {
    return false
  }
}

export const videoIdentity = (href: string) => {
  try {
    const url = new URL(href)
    const match = url.pathname.match(/^\/video\/([^/]+)\/?$/)
    if (url.protocol !== 'https:' || url.hostname !== 'www.bilibili.com' || !match) {
      return null
    }
    const rawPart = url.searchParams.get('p')
    const requestedPart = rawPart && /^\d+$/.test(rawPart) ? Number(rawPart) : 1
    const part = Number.isSafeInteger(requestedPart) && requestedPart >= 2 ? requestedPart : 1
    return `${match[1]}:${part}`
  } catch {
    return null
  }
}

export const isPlayerReady = (player: Element | null | undefined) =>
  Boolean(player && dq(player, 'video'))

export const queryUniqueResult = (
  scope: QueryScope | null | undefined,
  candidates: readonly string[],
): UniqueResult => {
  if (!scope) {
    return { ambiguous: false, node: null }
  }
  for (const selector of candidates) {
    const matches = scope.querySelectorAll(selector)
    if (matches.length === 0) {
      continue
    }
    return matches.length === 1
      ? { ambiguous: false, node: matches[0] }
      : { ambiguous: true, node: null }
  }
  return { ambiguous: false, node: null }
}

export const queryUnique = (scope: QueryScope | null, candidates: readonly string[]) =>
  queryUniqueResult(scope, candidates).node

export const collectSelectorMatches = (scope: QueryScope, selectors: readonly string[]) => {
  const matches = new Set<Element>()
  for (const selector of selectors) {
    const elementScope = scope as Element
    if (typeof elementScope.matches === 'function' && elementScope.matches(selector)) {
      matches.add(elementScope)
    }
    scope.querySelectorAll(selector).forEach(node => matches.add(node))
  }
  return matches
}

export const directChildContaining = (slot: Element | null, node: Element | null) => {
  if (!slot || !node || node === slot || !slot.contains(node)) {
    return null
  }
  let directChild = node
  while (directChild.parentElement && directChild.parentElement !== slot) {
    directChild = directChild.parentElement
  }
  return directChild.parentElement === slot ? directChild : null
}

export const isPageLayoutBranch = (branch: Element | null) =>
  Boolean(
    branch?.matches('.video-main, .left-container, .right-container, .video-page-v1, main, #app'),
  )

export const matchesSourceFingerprint = (candidate: Element | null, source: Element | null) => {
  if (!candidate || !source || candidate.tagName !== source.tagName) {
    return false
  }
  const stableId = source.id && !source.id.startsWith('bsv-') ? source.id : null
  const stableClasses = [...source.classList].filter(className => !className.startsWith('bsv-'))
  if (!stableId && stableClasses.length === 0) {
    return false
  }
  return (
    (!stableId || candidate.id === stableId) &&
    stableClasses.every(className => candidate.classList.contains(className))
  )
}

export const promoteLogicalRoot = (
  node: Element | null,
  logicalParent: Element | null | undefined,
  initialPageElements?: WeakSet<Element> | null,
  scope: Element | null = null,
) => {
  if (!node) {
    return null
  }
  let candidateSource = logicalParent?.contains(node) ? logicalParent : null
  if (!candidateSource && initialPageElements) {
    candidateSource = node.parentElement
    while (candidateSource && !initialPageElements.has(candidateSource)) {
      candidateSource = candidateSource.parentElement
    }
  }
  if (!candidateSource && logicalParent) {
    candidateSource = node.parentElement
    while (candidateSource && (!scope || scope.contains(candidateSource))) {
      if (candidateSource !== scope && matchesSourceFingerprint(candidateSource, logicalParent)) {
        break
      }
      if (candidateSource === scope) {
        candidateSource = null
        break
      }
      candidateSource = candidateSource.parentElement
    }
  }
  if (scope && candidateSource && (candidateSource === scope || !scope.contains(candidateSource))) {
    candidateSource = null
  }
  return directChildContaining(candidateSource, node) || node
}

export const resolveInitialLogicalRootResult = (
  pageRoot: Element | null,
  selectors: readonly string[],
  counterpartSelectors: readonly string[],
): UniqueResult => {
  if (!pageRoot) {
    return { ambiguous: false, node: null }
  }
  for (const selector of selectors) {
    const matches = [...pageRoot.querySelectorAll(selector)]
    if (matches.length === 0) {
      continue
    }
    if (matches.length > 1) {
      return { ambiguous: true, node: null }
    }
    const [node] = matches
    if (selector.startsWith('#')) {
      return { ambiguous: false, node }
    }
    const evidenceSelector =
      selectors === SELECTORS.player
        ? '[role="toolbar"], .player-controls'
        : 'h2, h3, .comments-heading'
    if (collectSelectorMatches(node, counterpartSelectors).size > 0) {
      return { ambiguous: true, node: null }
    }
    let branch = node
    while (branch.parentElement && branch.parentElement !== pageRoot) {
      const currentBranch = branch
      const parent = branch.parentElement
      const sameTypeDiverges = [...collectSelectorMatches(parent, selectors)].some(
        candidate =>
          candidate !== currentBranch &&
          !currentBranch.contains(candidate) &&
          !candidate.contains(currentBranch),
      )
      if (
        isPageLayoutBranch(parent) ||
        sameTypeDiverges ||
        collectSelectorMatches(parent, counterpartSelectors).size > 0
      ) {
        break
      }
      const hasSiblingEvidence = [...parent.children].some(
        child => child !== currentBranch && child.matches(evidenceSelector),
      )
      if (hasSiblingEvidence) {
        return { ambiguous: false, node: parent }
      }
      branch = parent
    }
    return { ambiguous: false, node }
  }
  return { ambiguous: false, node: null }
}

export const resolveLogicalRootResult = (
  scope: Element | null,
  selectors: readonly string[],
  logicalParent?: Element | null,
  acceptCandidate: (candidate: Element) => boolean = () => true,
  promoteCandidate?: (
    candidate: Element,
    selector: string,
    candidates: Element[],
  ) => Element | null,
): UniqueResult => {
  if (!scope) {
    return { ambiguous: false, node: null }
  }
  for (const selector of selectors) {
    const candidates = [...scope.querySelectorAll(selector)].filter(
      node =>
        acceptCandidate(node) &&
        (!logicalParent || (node !== logicalParent && !node.contains(logicalParent))),
    )
    const roots = new Set(
      candidates.map(
        node =>
          promoteCandidate?.(node, selector, candidates) ||
          directChildContaining(logicalParent ?? null, node) ||
          node,
      ),
    )
    if (roots.size === 0) {
      continue
    }
    return roots.size === 1
      ? { ambiguous: false, node: roots.values().next().value ?? null }
      : { ambiguous: true, node: null }
  }
  return { ambiguous: false, node: null }
}

export const resolvePageTreeNodes = (pageRoot: Element | null, nodes: ManagedNodesHint) => {
  const resolveRoot = (
    selectors: readonly string[],
    otherSelectors: readonly string[],
    logicalParent?: Element | null,
  ) =>
    resolveLogicalRootResult(
      pageRoot,
      selectors,
      logicalParent,
      undefined,
      (node, selector, selectorMatches) => {
        const logicalRoot = promoteLogicalRoot(
          node,
          logicalParent,
          nodes.initialPageElements,
          pageRoot,
        )
        if (logicalRoot !== node) {
          return logicalRoot
        }
        if (selector.startsWith('#')) {
          return node
        }
        const otherMatches = pageRoot ? [...collectSelectorMatches(pageRoot, otherSelectors)] : []
        const wrapperEvidenceSelector =
          selectors === SELECTORS.player
            ? '[role="toolbar"], .player-controls'
            : 'h2, h3, .comments-heading'
        const hasWrapperEvidence = (branch: Element) =>
          [...branch.children].some(child => child.matches(wrapperEvidenceSelector))
        const immediateParent = node.parentElement
        if (
          immediateParent &&
          immediateParent !== pageRoot &&
          !isPageLayoutBranch(immediateParent) &&
          !matchesSourceFingerprint(immediateParent, logicalParent ?? null) &&
          hasWrapperEvidence(immediateParent) &&
          !otherMatches.some(otherNode => immediateParent.contains(otherNode))
        ) {
          return immediateParent
        }
        let branch = node
        while (branch !== pageRoot && branch.parentElement) {
          const currentBranch = branch
          const parent = branch.parentElement
          if (parent !== pageRoot && !pageRoot?.contains(parent)) {
            break
          }
          const sameTypeDiverges = selectorMatches.some(
            candidate => parent.contains(candidate) && !currentBranch.contains(candidate),
          )
          const otherTypeDiverges = otherMatches.some(
            candidate => parent.contains(candidate) && !currentBranch.contains(candidate),
          )
          if (sameTypeDiverges || otherTypeDiverges) {
            return !isPageLayoutBranch(branch) && hasWrapperEvidence(branch) ? branch : node
          }
          branch = parent
        }
        return node
      },
    )
  const playerResult = resolveRoot(SELECTORS.player, SELECTORS.comments, nodes.playerSource)
  const commentsResult = resolveRoot(SELECTORS.comments, SELECTORS.player, nodes.commentsSource)
  if (playerResult.ambiguous) {
    return { comments: null, player: null }
  }
  return {
    comments: commentsResult.ambiguous ? null : commentsResult.node,
    player: playerResult.node,
  }
}

export const resolveManagedSlotResult = (
  slot: Element | null,
  selectors: readonly string[],
  trackedNode: Element | null = null,
  excludedId: string | null = null,
): UniqueResult => {
  if (!slot) {
    return { ambiguous: false, node: null }
  }
  const candidates = [...slot.children].filter(
    node => excludedId === null || node.id !== excludedId,
  )
  const trackedRoot = directChildContaining(slot, trackedNode)
  if (trackedRoot && candidates.includes(trackedRoot)) {
    return { ambiguous: false, node: trackedRoot }
  }
  for (const selector of selectors) {
    const matches = candidates.filter(
      node => node.matches(selector) || Boolean(node.querySelector(selector)),
    )
    if (matches.length === 0) {
      continue
    }
    return matches.length === 1
      ? { ambiguous: false, node: matches[0] }
      : { ambiguous: true, node: null }
  }
  return {
    ambiguous: candidates.length > 1,
    node: candidates.length === 1 ? candidates[0] : null,
  }
}

const collectManagedPageRootsForSelector = (slot: Element | null, selector: string) => {
  if (!slot) {
    return []
  }
  return [
    ...new Set(
      [...slot.querySelectorAll(selector)]
        .map(node => directChildContaining(slot, node))
        .filter((node): node is Element => Boolean(node)),
    ),
  ]
}

export const collectManagedPageRoots = (slot: Element | null) => {
  for (const selector of MANAGED_PAGE_ROOT_SELECTORS) {
    const roots = collectManagedPageRootsForSelector(slot, selector)
    if (roots.length > 0) {
      return roots
    }
  }
  return []
}

export const collectAllManagedPageRoots = (slot: Element | null) => [
  ...new Set(
    MANAGED_PAGE_ROOT_SELECTORS.flatMap(selector =>
      collectManagedPageRootsForSelector(slot, selector),
    ),
  ),
]

export const resolveManagedPageRoot = (slot: Element | null, trackedNode?: Element | null) => {
  if (!slot) {
    return null
  }
  const trackedRoot = directChildContaining(slot, trackedNode ?? null)
  const roots = collectManagedPageRoots(slot)
  if (roots.length === 1) {
    return roots[0]
  }
  if (roots.length > 1) {
    return trackedRoot
  }
  if (trackedRoot) {
    return trackedRoot
  }
  const directChildren = [...slot.children]
  return directChildren.length === 1 ? directChildren[0] : null
}

export const resolveActivePageRoot = (activeShell: Element, trackedPageRoot?: Element | null) => {
  const leftScroll = queryUnique(activeShell, ['#bsv-left-scroll'])
  return resolveManagedPageRoot(leftScroll, trackedPageRoot)
}

export const resolveNodes = (
  document: Document,
  retainedNodes: ManagedNodesHint | null = null,
  trackedNodes: ManagedNodesHint | null = null,
): ResolvedNodes | null => {
  const shellResult = queryUniqueResult(document, ['#bsv-shell'])
  if (shellResult.ambiguous) {
    return null
  }
  const activeShell = shellResult.node
  const currentNodes = trackedNodes ?? retainedNodes
  let pageRoot: Element | null = null
  let player: Element | null = null
  let comments: Element | null = null
  let author: Element | null = null

  if (activeShell) {
    const playerSlot = queryUnique(activeShell, ['#bsv-player-slot'])
    const commentsScroll = queryUnique(activeShell, ['#bsv-comments-scroll'])
    const authorCard = queryUnique(activeShell, ['#bsv-author-card'])
    pageRoot = resolveActivePageRoot(activeShell, currentNodes?.pageRoot)
    const pageTreeReplaced = Boolean(
      currentNodes?.pageRoot &&
        pageRoot !== currentNodes.pageRoot &&
        !pageRoot?.contains(currentNodes.pageRoot),
    )
    if (pageTreeReplaced) {
      ;({ comments, player } = resolvePageTreeNodes(pageRoot, currentNodes ?? {}))
    } else {
      player = resolveManagedSlotResult(
        playerSlot,
        SELECTORS.player,
        currentNodes?.player ?? null,
      ).node
      const managedComments = resolveManagedSlotResult(
        commentsScroll,
        SELECTORS.comments,
        currentNodes?.comments ?? null,
        'bsv-comments-waiting',
      )
      if (!managedComments.ambiguous) {
        comments =
          managedComments.node ||
          promoteLogicalRoot(
            queryUnique(pageRoot, SELECTORS.comments),
            currentNodes?.commentsSource,
            currentNodes?.initialPageElements,
            pageRoot,
          )
      }
      const managedAuthor = resolveManagedSlotResult(
        authorCard,
        SELECTORS.author,
        currentNodes?.author ?? null,
      )
      if (!managedAuthor.ambiguous) {
        author = managedAuthor.node || queryUnique(pageRoot, SELECTORS.author)
      }
    }
  } else {
    const resolvedPageRoot = queryUnique(document, SELECTORS.pageRoot)
    pageRoot = retainedNodes
      ? promoteLogicalRoot(
          resolvedPageRoot,
          retainedNodes.pageSource,
          retainedNodes.initialPageElements,
        )
      : resolvedPageRoot
    if (retainedNodes) {
      ;({ comments, player } = resolvePageTreeNodes(pageRoot, retainedNodes))
    } else {
      const playerResult = resolveInitialLogicalRootResult(
        pageRoot,
        SELECTORS.player,
        SELECTORS.comments,
      )
      const commentsResult = resolveInitialLogicalRootResult(
        pageRoot,
        SELECTORS.comments,
        SELECTORS.player,
      )
      player = playerResult.ambiguous ? null : playerResult.node
      comments = commentsResult.ambiguous ? null : commentsResult.node
    }
    author = queryUnique(pageRoot, SELECTORS.author)
  }

  if (!player || !pageRoot) {
    return null
  }
  return {
    pageRoot,
    player,
    comments,
    author,
    header: queryUnique(document, SELECTORS.header),
  }
}

export const capturePlacement = <T extends Element>(
  node: T | null | undefined,
): Placement<T> | null =>
  node
    ? {
        node,
        parent: node.parentNode as ManagedParent | null,
        nextSibling: node.nextSibling,
        style: node.getAttribute('style'),
      }
    : null

export const restoreManagedPayload = (
  logicalPlacement: Placement | null,
  payload: readonly (Element | null | undefined)[],
  canonicalNode: Element | null,
  restoreCanonical: boolean,
  fallbackParent: ManagedParent | null,
  fallbackNextSibling: ChildNode | null = null,
  allowDisconnectedParent = false,
) => {
  const uniquePayload = [...new Set(payload)].filter((node): node is Element => Boolean(node))
  const retainedPayload = uniquePayload.filter(node => node !== canonicalNode || restoreCanonical)
  if (retainedPayload.length === 0) {
    return
  }

  const canContainPayload = (
    candidate: ManagedParent | null | undefined,
  ): candidate is ManagedParent =>
    Boolean(
      candidate &&
        (candidate.isConnected || allowDisconnectedParent) &&
        !retainedPayload.some(node => node === candidate || node.contains(candidate)),
    )
  const recordedParent = logicalPlacement?.parent
  const canUseRecordedParent = canContainPayload(recordedParent)
  const fallbackBody = fallbackParent?.ownerDocument?.body || recordedParent?.ownerDocument?.body
  const parent = canUseRecordedParent
    ? recordedParent
    : [fallbackParent, fallbackBody].find(canContainPayload)
  if (!parent) {
    return
  }

  const restoreStyle = (node: Element) => {
    if (node !== logicalPlacement?.node) {
      return
    }
    if (logicalPlacement.style === null) {
      node.removeAttribute('style')
    } else {
      node.setAttribute('style', logicalPlacement.style)
    }
  }
  const insertGroup = (nodes: Element[], nextSibling: ChildNode | null | undefined) => {
    if (nodes.length === 0) {
      return
    }
    const ownerDocument = parent.ownerDocument ?? (parent as unknown as Document)
    const fragment = ownerDocument.createDocumentFragment()
    nodes.forEach(node => {
      restoreStyle(node)
      fragment.append(node)
    })
    parent.insertBefore(fragment, nextSibling?.parentNode === parent ? nextSibling : null)
  }

  const hasCanonical = restoreCanonical && canonicalNode && retainedPayload.includes(canonicalNode)
  if (!canUseRecordedParent || !hasCanonical) {
    let nextSibling = null
    if (canUseRecordedParent) {
      nextSibling = logicalPlacement?.nextSibling
    } else if (parent === fallbackParent) {
      nextSibling = fallbackNextSibling
    }
    insertGroup(retainedPayload, nextSibling)
    return
  }

  const recordedNextSibling =
    logicalPlacement?.nextSibling?.parentNode === parent ? logicalPlacement.nextSibling : null
  const afterRecordedSibling = recordedNextSibling?.nextSibling || null
  insertGroup([canonicalNode], recordedNextSibling)
  insertGroup(
    retainedPayload.filter(node => node !== canonicalNode),
    afterRecordedSibling,
  )
}

export const restoreAttribute = (element: Element, name: string, value: string | null) => {
  if (value === null) {
    element.removeAttribute(name)
  } else {
    element.setAttribute(name, value)
  }
}
