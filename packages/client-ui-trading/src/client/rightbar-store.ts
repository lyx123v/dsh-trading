/**
 * 宿主右侧栏展开状态镜像（只读 observable）。
 *
 * 0.1.5 起宿主 details 列由官方 sidebar-right dock（文件/预览等页签）接管，
 * 其开合的唯一事实源在宿主：右栏轨道为 0（收起）时 frame 写
 * `data-rightbar-collapsed`，展开时移除（dsh-client-ui-layout AppFrame，
 * 布局 store 驱动，与本项目 CSS 覆盖无反馈回路）。本 store 以
 * MutationObserver 把该属性镜像为布尔快照（true = 展开），供 SessionRail
 * 的「文件」页签消费——页签激活态即宿主 dock 的展开态，宿主侧入口（对话内
 * 文件链接、工具行引用、dock 自身开合钮）与本侧页签共用同一状态。
 *
 * 观察器在首次订阅时安装、末个订阅者退订时断开（SessionRail 恒挂载 =
 * 单一常驻消费者）；宿主未挂载（frame 未出现）时快照恒 false。宿主服务
 * （ctx.sidebarRight）不在本模块解析——开合动作面在 client/index.ts 注入。
 */
import { createObservable, type Observable } from './store.ts'

export type RightbarStore = Observable<boolean>

let singleton: RightbarStore | undefined

/** 宿主右侧栏展开状态镜像 Store（进程内单例）。 */
export function rightbarStore(): RightbarStore {
  if (singleton !== undefined) return singleton
  const base = createObservable<boolean>(false)
  let observer: MutationObserver | undefined
  let refcount = 0

  const read = (): boolean => {
    const frame = document.querySelector('[data-shell-overlay]')?.parentElement
    return frame != null && !frame.hasAttribute('data-rightbar-collapsed')
  }

  const sync = (): void => {
    const next = read()
    if (next !== base.getSnapshot()) base.set(next)
  }

  singleton = {
    getSnapshot: base.getSnapshot,
    subscribe(listener) {
      const unsubscribe = base.subscribe(listener)
      refcount += 1
      if (observer === undefined) {
        sync()
        observer = new MutationObserver(sync)
        // attributeFilter 限定唯一关心的属性；childList 兜宿主 frame 晚挂载
        // 与整个换挂（SPA 重挂）两种时机。回调节流不做：read() 是一次
        // data 属性 querySelector + 布尔比较，宿主渲染提交频率下成本可忽略。
        observer.observe(document.body, {
          subtree: true,
          childList: true,
          attributes: true,
          attributeFilter: ['data-rightbar-collapsed'],
        })
      }
      return () => {
        unsubscribe()
        refcount -= 1
        if (refcount === 0 && observer !== undefined) {
          observer.disconnect()
          observer = undefined
        }
      }
    },
  }
  return singleton
}
