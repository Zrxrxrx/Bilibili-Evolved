import { defineComponentMetadata } from '@/components/define'
import { createSplitViewController, SplitViewController } from './controller'

let controller: SplitViewController | null = null

const load = () => {
  controller?.stop()
  controller = createSplitViewController()
  controller.start()
}

const unload = () => {
  controller?.stop()
  controller = null
}

export const component = defineComponentMetadata({
  name: 'videoSplitView',
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
  reload: load,
  unload,
})
