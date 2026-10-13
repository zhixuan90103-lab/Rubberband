# Sling Kong 手感

对照对象是 Protostar 2015 年的 **Sling Kong**。

- §1–§6、§8 是检索结论和来源。数字没被录像复核之前，保持原样。
- §7 是已经写进 `src/game/tune.ts` 的常数。改手感先改那里，再改这一节，两边用同一组数。
- 这一版做了什么、还没做什么，见 [MVP-PLAN.md](./MVP-PLAN.md)。谁积分、谁写规则，见 [PHYSICS-PLAN.md](./PHYSICS-PLAN.md)。

不包含震动、金币、音效方案、角色差异和商业化。

配套：[AGENTS.md](../AGENTS.md) · [ENGINEERING.md](./ENGINEERING.md) · [MVP-PLAN.md](./MVP-PLAN.md)

## 1. 要做的手感

在竖道上按住角色、反拉、松手，把角色从一颗圆钉弹到下一颗。手臂拉伸是力度反馈。原作没有瞄准箭头。

一条循环：

1. 挂钉。角色连在当前钉上，作为下一次弹射的锚点。
2. 反拉。必须按在角色上。拖动方向是发射的反方向，可向下或向侧面拉。拉得越远，初速越大。松手前不发射。
3. 松手。按松手那一刻的拉向量发射。
4. 飞行。公开资料没有空中第二输入。改向靠撞墙反弹。
5. 接钉。碰到下一颗钉就抓住。
6. 溶解。挂住后倒计时，到时钉消失，人坠落。

不是钟摆松手脱钩，也不是带弹道虚线的弹弓拆塔。

## 2. 原型参数

| 项 | 暂定 | 状态 |
|---|---|---|
| 普通钉溶解 | 5 秒，从挂上开始 | 采用。与 2015-08 StopGame「蓝钉约 7 秒」冲突，见 §4 |
| 红钉溶解 | 3 秒，挂上后即进入更快的消失 | 采用。来源是玩家维基，不是官方 |
| 再抓住同一颗钉 | 溶解计时重置 | 两篇 2015 攻略。尚未对录像 |
| 刚离开的那颗钉 | 短时间不能立刻重新挂上 | 原型保护，时长待定。避免原地无限重置 |
| 同时可读的下一钉 | 通常 1 颗，最多 2 颗 | StopGame，2015-08 |
| 全局速度系数 | 不随高度增加 | 无「飞得更快」的记载。压力来自溶解、移动钉、陷阱 |
| 镜头 | 瞄准时当前钉和下一钉留在画面内 | 跟随延迟、反拉时锁不锁镜：未知，不写死 |

分数等于爬升高度。死亡是没抓住、溶解后坠落、或撞上杀伤障碍。

## 3. 已核对、可当事实用

- 初速和方向由这一下的拉距、拉方向决定，松手提交。
- 起点是按在角色上。TouchArcade 把「任意处拖」写成希望有的改进，说明原作不是任意处拖。
- 原作无瞄准箭头。同一篇评测明确希望有箭头。
- 蓝钉慢于红钉。蓝钉消失前会 ticking。红钉更快，一接触可开始闪。
- 可撞墙反弹改道。也可能弹回上一颗钉，评测把这写成难受点。
- 坠落杀死玩家的位置在画面里看不清。
- 钉子会移动、旋转；另有飞行钉，轨迹大致可预测。
- 2015-08 发售时，评测只点名三类障碍：间歇喷火的花、圆锯（静止或左右移动）、对撞石柱。148 Apps 另提到 bumper。
- 角色不改变这套弹射物理。StopGame、148 Apps 都写成外观差异。

## 4. 来源冲突（不要混进同一组数字）

溶解秒数只有两套说法：

- StopGame，2015-08-23，作者写在 iOS 上玩过：蓝钉大约 7 秒；红钉一挂上就闪。没写红钉总秒数。
- Fandom Obstacles：普通钉 5 秒，红钉 3 秒。页面摘录，整页当时被 CDN 挡住，未逐段复核。

原型只用 5 秒 / 3 秒。7 秒只作为对照，不和 5 秒同时生效。

另外两句不冲突：

- 没有整局倒计时，人可以在钉消失前停留。溶解仍在逼这一下。
- 「一开始就难」和「越高陷阱越密」可以同时成立。两者都不是飞行速度随高度变快。

## 5. 仍空着

看到原作录像之前不填：

1. 同样拉满，低处和高处从松手到抓住差几帧。
2. 反拉时钉子是否停在画面同一高度。
3. 旧钉保护时间具体多少。
4. 吸附半径、最低拖距、拉距到初速的曲线、最大拉伸。

## 6. 有效来源

评测：

- [148 Apps](https://www.148apps.com/sling-kong/sling-kong-review/)，2015-08-09
- [TouchArcade](https://toucharcade.com/2015/08/21/sling-kong-review/)，2015-08-21
- [StopGame](https://stopgame.ru/show/57211/sling_kong_review)，2015-08-23
- [MobileSyrup](https://mobilesyrup.com/2018/07/07/sling-kong-game-of-the-week/)，2018-07-07
- [DroidGamers](https://www.droidgamers.com/news/game-news/protostar-games-is-releasing-sling-kong-tomorrow/)，2015-08-06

攻略与维基：

- [LevelWinner](https://www.levelwinner.com/sling-kong-tips-cheats-tricks-to-get-a-high-score-and-unlock-new-characters/)，2015-08-14。再抓重置。
- [Fandom Obstacles](https://sling-kong.fandom.com/wiki/Obstacles)。5 秒 / 3 秒、飞行钉。玩家维基。

商店与官网只确认产品描述，不提供速度、镜头或秒数：

- [App Store](https://apps.apple.com/us/app/sling-kong/id989080135)
- [Protostar](https://protostargames.com/game/sling-kong/)

不采用 Minigamesville、Poki、Kiz10、8Games、Y8、Playgama 上的玩法介绍。那些页面把复刻或门户文案写成原作。

## 7. 已落地的手感

这些数是为 390×844 写的，不是原作实测。现行规则和默认数在 [PHYSICS-PLAN.md](./PHYSICS-PLAN.md)。代码真源是 `src/game/tune.ts` 的 `feelDefaults`。下面只留和原作对照时还要用的结构，不再单列一套旧常数。

`HANG_DROP`、`LAUNCH_SCALE`、`ARM_RATE`、`CATCH_KEEP`、`RETURN_LAG` 已经不在代码里。松弛长度由挂稳长度、重力和劲度算出。

渲染上同时成立的约定：

- 正交相机是 `left = 0`，`right = 390`，`top = 0`，`bottom = 844`，`near = 0.1`，`far = 50`，相机在 `z = 10`。投影的 Y 系数是负的，正面会被裁掉。角色、钉子、手臂、竖道都用 `MeshBasicMaterial` 的 `DoubleSide`。
- 镜头只改 `camera.position.y`。画面顶边是 `cameraY`。构图锚点在画面高度 70%，没有画出来。不用 `resizeToDesign`，也不用绘图缓冲的像素尺寸。
- 手臂不用 `Line`。WebGPU 把 `Line` 画成 1 像素的 `line-strip`。画面上是一张四肢贴图，从钉连到头顶，按钉心到身体的实际距离拉长。物理上仍是一条手臂。
- 命中不用 `Raycaster`。指针先读 `#stage` 的盒子，再换成设计坐标，然后 `pointerToWorld` 加上镜头。Letterbox 外忽略。
- 抓住、悬挂、飞行和墙在 Rapier 2D。发射的出手速率在 `sling.ts` 里按拉长量直接给出，不靠积分攒出来。状态是 `hang`、`drag`、`return`、`launch`、`fly`、`fall`。

### 当前这一版的物理

规则以 [PHYSICS-PLAN.md](./PHYSICS-PLAN.md) 为准。这里只保留和操作对应的几句。

身体在抓住、悬挂和飞行时受一个重力。发射收回的那一小段不受重力，也不受阻尼，避免同样的拉长因为方向或步长走出不同的速率。

拉动时手指按住身体。任意方向，最长是拉长上限。死区是挂稳长度之外的 `minPull`。不到就进入 `return`，由同一股手臂力拉回去。过了才发射。手指移动的快慢不加进出手速度。

发射方向是松手时从身体指向钉子。正下方拉开就向上飞，拉到钉子上方就向下飞。飞行中不能再拉。

身体中心进入抓取半径才抓住。刚脱开的钉要锁定期走完，并且身体离开过它的范围。抓住后留下当时的速度，同一股手臂力从当时的距离把多出来的劲泄掉，停在挂稳长度附近。不再换成一条定长绳子，也不把身体瞬移到钉下。

撞左右墙会弹开。飞过最下面那颗钉并且掉出镜头下方，才进入 `fall`。

2026-10-12 的参考录像用来对悬挂姿势、画面里同时能看见的钉子、松手闪光、飞行旋转和抓住时的压扁。锯、火、碾压、金币和大号高度数字不在这一版里。

## 8. 开源对照（2026-10-10）

没有找到和「按住角色、反拉、松手、抓住下一颗钉」同一条循环的开源项目，也没有 TypeScript + Three.js WebGPU 的实现。不把下面任何仓库接进底座。

可引用的仓库只说明它们是别的玩法：

| 来源 | 能支撑的结论 |
|---|---|
| [emjose/slingshot](https://github.com/emjose/slingshot) | Matter.js 弹弓拆塔。松手才发射。不抓下一颗钉 |
| [Hx2heng/SlingShot](https://github.com/Hx2heng/SlingShot) | Canvas 手机弹弓，只接触摸 |
| [ryanakca/slingshot](https://github.com/ryanakca/slingshot) | Pygame 太空对射，GPL-2.0。回合制 |
| [christophmark/pendulum](https://github.com/christophmark/pendulum) | Phaser + p2.js。按住甩绳，松手断绳。MIT |
| [ibrews/swing-city](https://github.com/ibrews/swing-city) | 单文件 Three.js。按住荡绳，弧底松手，还能收放绳 |
| [seltzerfish/grapple-game](https://github.com/seltzerfish/grapple-game) | 原生 JS 钩爪解谜 |
| [lylaminju/climick-client](https://github.com/lylaminju/climick-client) | Pixi。拖手脚放到岩点上才固定。最接近「抓住」，输入不是反拉 |
| [TomNeyland/endless-tower](https://github.com/TomNeyland/endless-tower) | Angular + Phaser 的 Icy Tower。竖屏向上，有撞墙，靠跑跳 |
| [tsherif/climb](https://github.com/tsherif/climb) | Canvas 竖屏平台跳跃。AGPL-3.0 |
| [stevenryan/PokeClimb](https://github.com/stevenryan/PokeClimb) | Phaser 3。点击起跳的无限向上 |

不采用 [githubgames.gitlab.io 的 Sling Kong 页](https://githubgames.gitlab.io/game/sling-kong.html)。那是游戏门户，没有源码。页上写的「按住越久甩得越远」也不能当作原作操作。

写法上只借两处，不借它们的物理引擎：`emjose/slingshot` 的松手才提交；`climick-client` 自己算重力、放到点上就固定。钟摆、钩爪、Icy Tower 的动量跳不作为实现参考。

## 9. 变更

| 日期 | 说明 |
|---|---|
| 2026-10-10 | 三轮检索后的手感结论。原型溶解取 5 秒 / 3 秒 |
| 2026-10-10 | 实现检索：正交设计坐标、距离判定、动态线段、暂定物理常数 |
| 2026-10-10 | 三轮反查：手臂改为平面；上升时减小 camera.position.y；UI 面板会挡住拖动 |
| 2026-10-10 | 开源对照：没有同一条拉射循环的仓库。不接入外部物理引擎 |
| 2026-10-12 | 常数改到与 `tune.ts` 一致：悬挂 78 px、身体锚在 70%、间距 100–130、前方 4 颗钉、两只手臂、手的位置接钉。溶解仍未做 |
| 2026-10-12 | 手臂改为皮筋收回再脱开。死区只靠拉长可见。按下打断回弹和摆动 |
| 2026-10-13 | 抓住后改成一条皮筋加定长绳子。旋转只在抓住后的过冲和回落里，停在头顶朝上。飞行不转 |
| 2026-10-13 | 现行规则改到 PHYSICS-PLAN。发射速率只由拉长量决定。默认劲度 26，重力 4000，拉长上限 145，死区 25 |
| 2026-10-12 | 拉距改成以钉子为圆心的 360°。身体碰到钉才抓住。悬挂改为软带，手臂画成弯带 |
| 2026-10-12 | 只留两颗钉。抓住保留速度并冲过钉子。坠落要飞过最下面那颗钉。镜头锚点画成白线 |
