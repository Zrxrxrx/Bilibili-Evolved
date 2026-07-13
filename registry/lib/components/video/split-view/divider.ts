import { CONFIG } from './dom'

export interface SplitState {
  ratio: number
}

export interface DividerController {
  applyRatio: () => void
  cancelDrag: () => void
  setMinRightWidth: (width: number) => void
  stop: () => void
}

const calculateLeftWidth = (shellWidth: number, pointerX: number, minRightWidth: number) => {
  const ratio = lodash.clamp(pointerX / shellWidth, CONFIG.minLeftRatio, 1)
  const ratioWidth = ratio * shellWidth
  const maxByRightPane = shellWidth - minRightWidth - CONFIG.dividerWidth
  return Math.min(maxByRightPane, Math.max(CONFIG.minLeftWidth, ratioWidth))
}

export const createDividerController = (
  window: Window,
  shell: HTMLElement,
  divider: HTMLElement,
  notifyResize: () => void,
  minRightWidth: number,
  splitState: SplitState = { ratio: CONFIG.defaultLeftRatio },
  isSuspended: () => boolean = () => false,
): DividerController => {
  let activePointerId: number | null = null
  let currentMinRightWidth = minRightWidth
  let stopped = false

  const getShellRect = () => {
    const rect = shell.getBoundingClientRect()
    const width = rect.width || shell.clientWidth || window.innerWidth
    return { left: rect.left || 0, width }
  }

  const applyPointer = (pointerX: number) => {
    const rect = getShellRect()
    const relativeX = pointerX - rect.left
    splitState.ratio = lodash.clamp(relativeX / rect.width, CONFIG.minLeftRatio, 1)
    const leftWidth = calculateLeftWidth(
      rect.width,
      rect.width * splitState.ratio,
      currentMinRightWidth,
    )
    shell.style.setProperty('--bsv-left-width', `${leftWidth}px`)
    notifyResize()
  }

  const applyRatio = () => {
    if (stopped || isSuspended()) {
      return
    }
    const rect = getShellRect()
    const leftWidth = calculateLeftWidth(
      rect.width,
      rect.width * splitState.ratio,
      currentMinRightWidth,
    )
    shell.style.setProperty('--bsv-left-width', `${leftWidth}px`)
    notifyResize()
  }

  const cancelDrag = () => {
    const pointerId = activePointerId
    activePointerId = null
    if (pointerId !== null && divider.hasPointerCapture?.(pointerId)) {
      try {
        divider.releasePointerCapture(pointerId)
      } catch (error) {
        console.warn('[videoSplitView] failed to release divider pointer capture', error)
      }
    }
    window.document.documentElement.classList.remove('bsv-dragging')
  }

  const onPointerDown = (event: PointerEvent) => {
    if (
      stopped ||
      isSuspended() ||
      activePointerId !== null ||
      !event.isPrimary ||
      event.button !== 0
    ) {
      return
    }
    divider.setPointerCapture?.(event.pointerId)
    activePointerId = event.pointerId
    window.document.documentElement.classList.add('bsv-dragging')
  }

  const onPointerMove = (event: PointerEvent) => {
    if (!stopped && !isSuspended() && event.pointerId === activePointerId) {
      applyPointer(event.clientX)
    }
  }

  const onPointerEnd = (event: PointerEvent) => {
    if (event.pointerId === activePointerId) {
      cancelDrag()
    }
  }

  const onResize = () => {
    applyRatio()
  }

  const setMinRightWidth = (width: number) => {
    currentMinRightWidth = width
    applyRatio()
  }

  const stop = () => {
    if (stopped) {
      return
    }
    stopped = true
    divider.removeEventListener('pointerdown', onPointerDown)
    divider.removeEventListener('pointermove', onPointerMove)
    divider.removeEventListener('pointerup', onPointerEnd)
    divider.removeEventListener('pointercancel', onPointerEnd)
    divider.removeEventListener('lostpointercapture', onPointerEnd)
    window.removeEventListener('resize', onResize)
    cancelDrag()
  }

  try {
    divider.addEventListener('pointerdown', onPointerDown)
    divider.addEventListener('pointermove', onPointerMove)
    divider.addEventListener('pointerup', onPointerEnd)
    divider.addEventListener('pointercancel', onPointerEnd)
    divider.addEventListener('lostpointercapture', onPointerEnd)
    window.addEventListener('resize', onResize)
    applyRatio()
  } catch (error) {
    stop()
    throw error
  }

  return { applyRatio, cancelDrag, setMinRightWidth, stop }
}
