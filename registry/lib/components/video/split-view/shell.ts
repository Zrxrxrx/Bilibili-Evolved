export interface SplitViewShell {
  authorCard: HTMLElement
  commentsScroll: HTMLElement
  commentsWaiting: HTMLElement
  divider: HTMLElement
  leftPane: HTMLElement
  leftScroll: HTMLElement
  playerSlot: HTMLElement
  rightPane: HTMLElement
  shell: HTMLElement
}

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
      <div id="bsv-comments-scroll">
        <div id="bsv-comments-waiting">正在等待评论区</div>
      </div>
    </aside>
  `
  const parts = {
    authorCard: getRequiredElement(shell, '#bsv-author-card'),
    commentsScroll: getRequiredElement(shell, '#bsv-comments-scroll'),
    commentsWaiting: getRequiredElement(shell, '#bsv-comments-waiting'),
    divider: getRequiredElement(shell, '#bsv-divider'),
    leftPane: getRequiredElement(shell, '#bsv-left-pane'),
    leftScroll: getRequiredElement(shell, '#bsv-left-scroll'),
    playerSlot: getRequiredElement(shell, '#bsv-player-slot'),
    rightPane: getRequiredElement(shell, '#bsv-right-pane'),
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
