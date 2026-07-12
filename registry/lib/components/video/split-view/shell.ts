export interface SplitViewShell {
  auxiliaryScroll: HTMLElement
  auxiliaryWaiting: HTMLElement
  authorCard: HTMLElement
  commentsScroll: HTMLElement
  commentsWaiting: HTMLElement
  divider: HTMLElement
  leftPane: HTMLElement
  leftScroll: HTMLElement
  playerSlot: HTMLElement
  rightPane: HTMLElement
  setActiveTab: (tab: RightPaneTab) => void
  shell: HTMLElement
}

export type RightPaneTab = 'comments' | 'auxiliary'

const getRequiredElement = (root: ParentNode, selector: string) => {
  const element = root.querySelector(selector)
  if (!(element instanceof HTMLElement)) {
    throw new Error(`[videoSplitView] missing shell element: ${selector}`)
  }
  return element
}

export const createSplitViewShell = (): SplitViewShell => {
  const shell = document.createElement('div')
  shell.id = 'bsv-shell'
  shell.innerHTML = `
    <section id="bsv-left-pane">
      <div id="bsv-player-slot"></div>
      <div id="bsv-left-scroll"></div>
    </section>
    <div id="bsv-divider" role="separator" aria-orientation="vertical"></div>
    <aside id="bsv-right-pane">
      <section id="bsv-author-card"></section>
      <section id="bsv-content-card">
        <div id="bsv-tabs" role="tablist" aria-label="侧栏内容">
          <button id="bsv-comments-tab" class="bsv-tab bsv-active" type="button" role="tab" aria-selected="true" aria-controls="bsv-comments-scroll">评论</button>
          <button id="bsv-auxiliary-tab" class="bsv-tab" type="button" role="tab" aria-selected="false" aria-controls="bsv-auxiliary-scroll">弹幕与推荐</button>
        </div>
        <div id="bsv-comments-scroll" class="bsv-tab-panel" role="tabpanel" aria-labelledby="bsv-comments-tab">
          <div id="bsv-comments-waiting">正在等待评论区</div>
        </div>
        <div id="bsv-auxiliary-scroll" class="bsv-tab-panel" role="tabpanel" aria-labelledby="bsv-auxiliary-tab" hidden>
          <div id="bsv-auxiliary-waiting">正在等待弹幕与推荐</div>
        </div>
      </section>
    </aside>
  `
  const auxiliaryScroll = getRequiredElement(shell, '#bsv-auxiliary-scroll')
  const commentsScroll = getRequiredElement(shell, '#bsv-comments-scroll')
  const auxiliaryTab = getRequiredElement(shell, '#bsv-auxiliary-tab')
  const commentsTab = getRequiredElement(shell, '#bsv-comments-tab')
  const scrollPositions: Record<RightPaneTab, number> = { auxiliary: 0, comments: 0 }
  let activeTab: RightPaneTab = 'comments'
  const setActiveTab = (tab: RightPaneTab) => {
    if (tab === activeTab) {
      return
    }
    const activePanel = activeTab === 'comments' ? commentsScroll : auxiliaryScroll
    const nextPanel = tab === 'comments' ? commentsScroll : auxiliaryScroll
    scrollPositions[activeTab] = activePanel.scrollTop
    const commentsActive = tab === 'comments'
    commentsTab.classList.toggle('bsv-active', commentsActive)
    commentsTab.setAttribute('aria-selected', String(commentsActive))
    auxiliaryTab.classList.toggle('bsv-active', !commentsActive)
    auxiliaryTab.setAttribute('aria-selected', String(!commentsActive))
    commentsScroll.hidden = !commentsActive
    auxiliaryScroll.hidden = commentsActive
    nextPanel.scrollTop = scrollPositions[tab]
    activeTab = tab
  }
  commentsTab.addEventListener('click', () => setActiveTab('comments'))
  auxiliaryTab.addEventListener('click', () => setActiveTab('auxiliary'))
  const parts = {
    auxiliaryScroll,
    auxiliaryWaiting: getRequiredElement(shell, '#bsv-auxiliary-waiting'),
    authorCard: getRequiredElement(shell, '#bsv-author-card'),
    commentsScroll,
    commentsWaiting: getRequiredElement(shell, '#bsv-comments-waiting'),
    divider: getRequiredElement(shell, '#bsv-divider'),
    leftPane: getRequiredElement(shell, '#bsv-left-pane'),
    leftScroll: getRequiredElement(shell, '#bsv-left-scroll'),
    playerSlot: getRequiredElement(shell, '#bsv-player-slot'),
    rightPane: getRequiredElement(shell, '#bsv-right-pane'),
    setActiveTab,
    shell,
  }
  parts.commentsScroll.replaceChildren(parts.commentsWaiting)
  try {
    document.body.append(shell)
    return parts
  } catch (error) {
    shell.remove()
    throw error
  }
}
