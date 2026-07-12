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
import { createSplitViewController, SplitViewController } from './controller'

const name = 'videoSplitView'
const minRightWidthPath = `${name}.minRightWidth`
const options = defineOptionsMetadata({
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
  const { minRightWidth } = getComponentSettings<Options>(name).options
  controller = createSplitViewController(minRightWidth)
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
