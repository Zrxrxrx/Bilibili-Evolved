import {
  defineComponentMetadata,
  defineOptionsMetadata,
  OptionsOfMetadata,
} from '@/components/define'
import {
  addComponentListener,
  getComponentSettings,
  removeComponentListener,
} from '@/core/settings'
import { getNumberValidator } from '@/core/utils'
import { createSplitViewController, SplitOrientation, SplitViewController } from './controller'
import { CONFIG } from './dom'

const name = 'videoSplitView'
const minRightWidthPath = `${name}.minRightWidth`
const options = defineOptionsMetadata({
  landscapeLeftRatio: {
    defaultValue: Number(CONFIG.defaultLeftRatio),
    hidden: true,
    validator: getNumberValidator(CONFIG.minLeftRatio, 1),
  },
  portraitLeftRatio: {
    defaultValue: Number(CONFIG.defaultLeftRatio),
    hidden: true,
    validator: getNumberValidator(CONFIG.minLeftRatio, 1),
  },
  minRightWidth: {
    displayName: '右侧评论区最小宽度 (px)',
    defaultValue: 320,
    slider: {
      min: 240,
      max: 530,
      step: 10,
    },
    validator: getNumberValidator(240, 530),
  },
})
type Options = OptionsOfMetadata<typeof options>

let controller: SplitViewController | null = null
let settingsListenerAttached = false

const setMinRightWidth = (width: number) => {
  controller?.setMinRightWidth(width)
}

const load = () => {
  controller?.stop()
  const settings = getComponentSettings<Options>(name)
  const { landscapeLeftRatio, minRightWidth, portraitLeftRatio } = settings.options
  const persistRatio = (orientation: SplitOrientation, ratio: number) => {
    if (orientation === 'portrait') {
      settings.options.portraitLeftRatio = ratio
    } else {
      settings.options.landscapeLeftRatio = ratio
    }
  }
  controller = createSplitViewController({
    minRightWidth,
    ratios: {
      landscape: landscapeLeftRatio,
      portrait: portraitLeftRatio,
    },
    onRatioCommitted: persistRatio,
  })
  controller.start()
  if (!settingsListenerAttached) {
    addComponentListener(minRightWidthPath, setMinRightWidth)
    settingsListenerAttached = true
  }
}

const unload = () => {
  controller?.stop()
  controller = null
  if (settingsListenerAttached) {
    removeComponentListener(minRightWidthPath, setMinRightWidth)
    settingsListenerAttached = false
  }
}

export const component = defineComponentMetadata({
  name,
  displayName: '视频分栏布局',
  tags: [componentsTags.video, componentsTags.style, componentsTags.experimental],
  author: {
    name: 'Zrxrxrx',
    link: 'https://github.com/Zrxrxrx',
  },
  urlInclude: ['//www.bilibili.com/video/'],
  instantStyles: [
    {
      name: 'videoSplitView',
      style: () => import('./video-split-view.scss'),
    },
  ],
  entry: load,
  options,
  reload: load,
  unload,
})
