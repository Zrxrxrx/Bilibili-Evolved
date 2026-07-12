import { defineComponentMetadata } from '@/components/define'

export const component = defineComponentMetadata({
  name: 'videoSplitView',
  displayName: '视频分栏布局',
  tags: [componentsTags.video, componentsTags.style, componentsTags.experimental],
  author: {
    name: 'Zrxrxrx',
    link: 'https://github.com/Zrxrxrx',
  },
  urlInclude: ['//www.bilibili.com/video/'],
  entry: none,
})
