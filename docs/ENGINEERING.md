# Engineering — portrait-webgpu-base

配套：[AGENTS.md](../AGENTS.md) · [ENTRYPOINTS.md](./ENTRYPOINTS.md) · [MERGE.md](./MERGE.md) · [AUDIO.md](./AUDIO.md) · [HAPTICS.md](./HAPTICS.md) · [SLING-KONG-FEEL.md](./SLING-KONG-FEEL.md) · [MVP-PLAN.md](./MVP-PLAN.md)

## 1. 定位

可复制的 **竖屏 WebGPU 手游底座**：能 dev、能 build、能真机、能震动、桌面≈手机/Pad。当前玩法是拉射，范围见 [MVP-PLAN.md](./MVP-PLAN.md)。底座约定不随玩法改。

## 2. 目录

```
portrait-webgpu-base/
├── AGENTS.md
├── README.md
├── docs/
├── index.html
├── vite.config.ts          # base: './' · port 5190
├── capacitor.config.ts     # contentInset never · scrollEnabled false
├── src/
│   ├── main.ts             # 场景、手臂、指针
│   ├── game/               # tune / pegs / sling / selftest
│   ├── create-renderer.ts
│   ├── style.css
│   ├── adapt/
│   │   ├── design.ts       # 390×844 · layout · clientToDesign
│   │   ├── devicePreview.ts
│   │   └── safeArea.ts
│   └── utils/haptics.ts
├── plugins/native-haptics/ # Swift 真源
└── scripts/bootstrap-ios.mjs
```

## 3. 配置表

### Vite

| 项 | 值 | 原因 |
|----|-----|------|
| `base` | `'./'` | Capacitor 相对路径 |
| `outDir` | `dist` | = webDir |
| `port` | `5190` | 固定端口 |
| `target` | `es2022` | WebGPU |

### Capacitor

| 项 | 值 |
|----|-----|
| `appId` | `com.wangzhixuan.rubberband`。不要改回共用的 hapticstest 包名 |
| `webDir` | `dist` |
| `ios.contentInset` | `never` |
| `ios.scrollEnabled` | `false` |
| `ios.backgroundColor` | `#0b1020` |

### 设计尺寸

| 常量 | 值 |
|------|-----|
| DESIGN_WIDTH / HEIGHT | 390 / 844 |
| DESIGN_SAFE top/bottom | 59 / 34（桌面模拟） |
| Phone 预览 | 390×844 |
| Pad 预览 | 768×1024（外层视口） |

改设计尺寸时同步：`design.ts`、`style.css` 中 `#stage` 宽高、`index.html` 若有硬编码。

## 4. 适配算法

```
scale = min(viewW/390, viewH/844)   // contain
offset = 居中
#stage transform: translate(offset) scale(scale)
renderer.setSize(390, 844)          // 始终设计分辨率
```

触控：读 `#stage` 的盒子换成设计坐标，再加镜头偏移。Letterbox 外忽略。不要从窗口原点用 `clientToDesign`，桌面预览的视口不在 (0, 0)。

## 5. Safe Area

| 环境 | 行为 |
|------|------|
| 桌面 | JS 写入 `--safe-*` = DESIGN_SAFE |
| 原生 | 去掉 inline，CSS `env(safe-area-inset-*)` |
| UI | `#ui-root` padding = safe + ui-pad |

3D 可全出血；可点 UI 只在 `#ui-root`。

## 6. WebGPU

- `createRenderer` → `three/webgpu` WebGPURenderer  
- 无 `navigator.gpu` / init 失败 → `showFatal`  
- DPR cap 默认 2  
- 禁止 `setSize(innerWidth, innerHeight)` 跟窗走  

## 7. Haptics

接线规范：[HAPTICS.md](./HAPTICS.md)

真源：`plugins/native-haptics/`  
JS：`src/utils/haptics.ts`（`registerPlugin('AdvancedHaptics')`）  
注册链路（Capacitor 8 真机已验通）：

```
SceneDelegate.rootViewController = BridgeViewController()
  → capacitorDidLoad
  → registerPluginInstance(AdvancedHapticsPlugin)
```

`ios:bootstrap` 会拷 Swift、改 storyboard、**改 SceneDelegate**、补 pbx。只 `cap:sync` 不够。

只改 storyboard **不够**：Capacitor 8 用 SceneDelegate 直接 `CAPBridgeViewController()`，会绕过 storyboard，HUD 出现 `plugin: false`，按钮无震。

Swift **没有** `prepare`；引擎在 `load()` 启动。UIKit 反馈在主线程触发。插件是否挂上，用真机上 `isPluginAvailable('AdvancedHaptics')` 和拉、抓时有没有震来确认。拉射页没有「点我震动」按钮。

玩法四处在 `src/game/feelHaptics.ts`。蓄力用连续震动加碎抖；抓住和回弹是一条 `playPattern`。规则和公式见 [HAPTICS.md](./HAPTICS.md) §8。默认数在 `hapticDefaults`。不要在 `main.ts` 里直接打插件。

## 7b. Audio（尚未实现）

本仓库无播放代码。接入规范见 [AUDIO.md](./AUDIO.md)：

- Loading **预解码**；热路径禁止 `new Audio()` / decode / 读盘
- `AudioBatcher`：**每帧最多一次** Capacitor 桥
- iOS 生产走 `AVAudioEngine` + PCM 缓存 + PlayerNode 池；**禁止**静默 WebAudio
- Catalog 管 cooldown / priority / maxVoices；忙帧再砍每帧条数

## 8. iOS 工作流

```bash
# 首次
npm install && npm run ios:bootstrap && npm run cap:open

# 日常
npm run cap:sync
```

## 8b. 拉射画面

玩法坐标是设计像素，y 向下，和 `clientToDesign` 同一套。正交相机 `top = 0`、`bottom = 844`，投影 Y 为负，`FrontSide` 会被裁掉，只剩清屏色。角色、钉子、手臂、竖道用 `DoubleSide`。

`resizeToDesign` 只接受透视相机。这里视锥就是 390×844，不跟窗口，也不用绘图缓冲宽度。跟随改 `camera.position.x` 和 `camera.position.y`。构图锚点在画面高度 70%，没有单独的线。左右何时偏移见 [PHYSICS-PLAN.md](./PHYSICS-PLAN.md)。

手臂是一张四肢贴图，从钉连到身体，按实际距离拉长。不要换回 `THREE.Line`，WebGPU 上它只有 1 像素。

`#ui-root` 在画布之上且默认不接指针。参数面板和死亡界面会接指针。玩法 HUD 不要再盖住竖道。

## 9. 已知坑

1. **不要**把 `base` 改回 `'/'`  
2. **不要** `contentInset: automatic`（双重 inset）  
3. Pad 预览禁止横向拉满 390 UI  
4. pbxproj 优先 bootstrap，少手改  
5. `dist` / `ios/.../public` 是产物  
6. 真机安装前改 `capacitor.config.ts` 的 `appId`，避免覆盖别的 App  
7. 震动没接上：先看 [HAPTICS.md §0](./HAPTICS.md)。常见断点是 SceneDelegate 仍是默认 VC，不是 storyboard 没改。不要只 `cap:sync`，不要用 `prepare()` 当验收  

## 10. 变更

| 日期 | 说明 |
|------|------|
| 2026-08-03 | 初版：合并 niantu + shell 为 portrait-webgpu-base |
| 2026-08-14 | 增加 AUDIO.md：音效不卡帧方案 |
| 2026-08-14 | 增加 HAPTICS.md：震动一次接对 |
| 2026-08-31 | 真机震动验通。根因：Capacitor 8 `SceneDelegate` 绕过 storyboard。bootstrap 现会改 SceneDelegate；HUD 用「点我震动」+ `plugin` 标志验收 |
| 2026-10-12 | 拉射替换 demo。正交负 Y 必须 `DoubleSide`。手感数字以 `src/game/tune.ts` 和 SLING-KONG-FEEL §7 为准 |
| 2026-10-12 | 文档与现行规则对齐：软带悬挂、360° 拉距、身体抓钉、Rapier 只负责收回、飞行和墙 |
| 2026-10-12 | 两颗钉、抓钉过冲、镜头 70% 白线写入手感、物理和范围文档 |
| 2026-10-13 | 手臂、过冲和转角改成一条规则。皮筋率数在 `sling.ts`。飞行不转。抓住后过冲和回落同一次旋转，停在头顶朝上 |
| 2026-10-13 | 现行规则收到 `docs/PHYSICS-PLAN.md`，数字真源是 `src/game/tune.ts`。出手速率是劲度乘伸长。默认劲度 26、重力 4000、拉长上限 145、死区 25。包名 `com.wangzhixuan.rubberband` |
| 2026-10-13 | 文档再次对齐。四颗钉，最下一行四等分。墙内侧面在设计屏外 12 px，弹性 0.3。左右镜头只在中线范围外朝墙拉时偏移，最多 36 px。画面规则写入 PHYSICS-PLAN「画面」 |
| 2026-10-14 | 文档再次对齐。出生钉绿色，下排左蓝右红，蓝 5 秒红 3 秒，灰 0.5 秒后恢复。死亡隐藏角色，用「再来一次」重开。重开是 0.8 倍拉满发射的飞行，从掉落时的水平位置飞回出生钉，飞行中转一圈 |
| 2026-10-14 | 文档再次对齐。出生钉到上一颗固定 600 px。铆钉画面 41.6×39.7。松手或挂满进入冷却，0.5 秒后清零。发射自转默认 4 rad/s，撞墙自转 0.002。抓住时发亮并扩开圆环 |
| 2026-10-14 | 摆钉改成持续往上铺。开局只有绿色出生钉，上一颗正中蓝钉在 400 px。之后一对或一颗，相邻行距 200 到 600。左右钉在距边缘 110 或 124。离开角色 1.5 个屏幕高度回收，18 个槽位复用。镜头在低于最低钉后不再下移，出画面下沿才死亡 |
| 2026-10-14 | 画面补三项，都只改画面。飞行沿速度拉长，满速约 9%，撞墙最扁约 0.89。撞墙在内侧面放浅石色扩散环，大小是抓住环的 1.75/1.15，不透明度 0.55 倍。掉落震镜头一次，0.34 秒，向下最多 10 px，偏移只加在 `camera.position` |
| 2026-10-15 | 抓住转头改看绳子摆不摆。`CatchFacing` 分 `watch`、`arc`、`settle`。离开抓住点 72 px 或绕钉约 60° 才走长弧。冲势先停则收到最近的头顶朝上。不看拉射力度，也不用碰上时的速度单独决定。规则在 PHYSICS-PLAN「转角和镜头」 |
| 2026-10-15 | 钉场改成镜头窗口，不再按离开角色 1.5 屏回收。补到画面顶以上 380 px，上下各留一个最长跳跃。槽位 24，空槽停到场外。层级是底盘、手臂、彩钉。规则在 PHYSICS-PLAN「钉场窗口」 |
| 2026-10-15 | 金币跟着钉行提前摆进两行中点，每 3 到 5 行一枚，不在飞行或抓住时生成，也不再抽钉子的随机数。只有向上的发射或飞行能捡。池子 8。画面是 `14-coin-sheet.png`。规则在 PHYSICS-PLAN「金币」 |
| 2026-10-15 | 金币画面边长 45，接触阴影比猴子更透，宽度跟着序列帧。左上角深色胶囊显示图标和数量，不再显示调试文字。捡到后 0.36 秒沿弧线飞向图标，先慢后快，先小幅放大再锁到图标大小。落到后图标弹一下，并叠一层加色闪光。规则在 PHYSICS-PLAN「金币」 |
