/**
 * 宿主右侧栏展开状态镜像（只读 observable）。
 *
 * 0.1.5 起宿主 details 列由官方 sidebar-right dock（文件/预览等页签）接管，
 * 其开合的唯一事实源在宿主：面板展开时写 `data-sidebar-right-open`、收起时移除
 * （dsh-client-ui-sidebar-right 的 SidebarRight 面板——收起后仍挂载在 DOM 里，
 * 只是被 transform 推到 frame 右缘之外）。本 store 以 MutationObserver 把该
 * 属性镜像为布尔快照（true = 展开），供 SessionRail 的「文件」页签消费——
 * 页签激活态即宿主 dock 的展开态，宿主侧入口（对话内文件链接、工具行引用、
 * dock 自身开合钮）与本侧页签共用同一状态。
 *
 * 不要改读 frame 的 `data-rightbar-collapsed`：那是「右栏**轨道**宽为 0」而不是
 * 「面板收起」。宿主在视口 < 768px 的 autoFullscreen 下「面板已展开但轨道为 0」
 * 同样会写它（dsh-client-ui-sidebar-right：track = shown && !autoFullscreen），
 * 读它会把页签状态读反——窄窗口下页签不亮、点不掉、互斥不生效；旧宿主
 * （≤0.1.4 无侧栏 dock、不写该属性）则相反：页签常亮并隐去对话列却无面板可看。
 * 2026-09-15 评审 M1。
 *
 * 观察器在首次订阅时安装、末个订阅者退订时断开（SessionRail 恒挂载 =
 * 单一常驻消费者）；宿主未挂载（面板未出现）时快照恒 false。宿主服务
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

  /** 唯一事实源：宿主面板自己写的展开标记（收起时移除，面板仍挂载）。 */
  const read = (): boolean =>
    document.querySelector('[data-sidebar-right-panel][data-sidebar-right-open]') !== null

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
        // attributeFilter 限定唯一关心的属性；childList 兜宿主面板晚挂载
        // 与整个换挂（SPA 重挂）两种时机。回调节流不做：read() 是一次
        // data 属性 querySelector + 布尔比较，宿主渲染提交频率下成本可忽略。
        observer.observe(document.body, {
          subtree: true,
          childList: true,
          attributes: true,
          attributeFilter: ['data-sidebar-right-open'],
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
