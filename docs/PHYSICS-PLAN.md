# 物理实现

手感数字以 [SLING-KONG-FEEL.md](./SLING-KONG-FEEL.md) §7 和 `src/game/tune.ts` 为准。范围见 [MVP-PLAN.md](./MVP-PLAN.md)。

## 谁负责什么

`@dimforge/rapier2d-compat` 是直接依赖。坐标是设计像素，+y 向下。`src/game/sim.ts` 管这些：

- 世界重力 `(0, GRAVITY)`
- 飞行和收回的固定步积分。`simStep` 把一帧拆成两小步，墙的反弹才能在同一帧里发生
- 身体圆，半径 `BODY_RADIUS`，密度 1，摩擦 0，连续碰撞
- 左右墙。固定方块，内侧面在 `SHAFT_LEFT` 和 `SHAFT_RIGHT`，恢复系数 `WALL_RESTITUTION`，合成取最大

这一版 Rapier 不会在 `step` 之后清掉用户力。`simStep` 末尾调用 `resetForces`。不清的话，收回时加上的弹簧力会一直叠，脱开后速度无限变大。

`src/game/sling.ts` 管规则，不交给引擎：死区、360° 拉动、旧钉锁、抓哪颗钉、按下打断、软带悬挂、坠落重开。悬挂不用 Rapier 旋转关节。关节曾把身体留在钉子上方，并灌进很大的向上速度。

锁文件里的 `@dimforge/rapier3d-compat` 是 Three 的传递依赖。玩法不 import，也不要用于这一条平面规则。

| 阶段 | 积分 |
|---|---|
| `drag` | 手指按住，不积分 |
| `return` | 动画，回到钉子正下方。按下打断 |
| `launch` | Rapier。拉力 `LAUNCH_SCALE² × 伸长` 指向钉子，另加重力。伸长不超过 0 就脱开 |
| `fly` | Rapier。只剩重力，墙可以反弹 |
| `hang` | 自己写的软带。见下文 |
| `fall` | 不积分。点一下重开 |

## 软带

自然长度是 `HANG_DROP`。短于它没有拉力。长于它，加速度是 `ARM_RATE² × (长度 − HANG_DROP)`，指向钉子。静止时身体在 `REST_DROP`，不是贴在松弛长度上。

悬挂时手留在钉子上，再次拉动之前不脱开。速度拆成沿手臂和垂直于手臂的两段，分别用 `ARM_DAMP` 和 `SWING_DAMP` 衰减。抓住时不取消朝向钉子的速度，整段速度乘 `CATCH_KEEP`（现在是 1），身体冲过钉子后再被拉回。

镜头的世界坐标是 `cameraY`，画面顶边在这里。盯住的点放在画面高度 `PEG_SCREEN_ANCHOR`（0.7）。挂着、拉动、弹回时目标是静止悬挂点。收回和飞行时目标是身体中心，收回阶段不会把目标放到悬挂点以下。飞过最下面那颗钉之后目标停住。镜头用 `CAMERA_DAMP` 做临界阻尼去追目标，所以启动和停止会缓入缓出，匀速时人仍在这条线上。这条线不画出来。

发射用 `LAUNCH_SCALE`，不用 `ARM_RATE`。两段都是 `sqrt(k/m)` 这种加速度，不是单独的质量和劲度。

## 还没有拆开的量

下面这些写过计划，这一版没有单独的常数：

| 量 | 现在怎么体现 |
|---|---|
| 质量 `m` | 折进加速度。Rapier 身体密度是 1，弹簧力再乘质量，所以改密度不会改变发射加速度 |
| 劲度 `k` | 发射是 `LAUNCH_SCALE²`，悬挂是 `ARM_RATE²` |
| 阻尼力 `−c v` | `ARM_DAMP` 和 `SWING_DAMP` 直接衰减速度，不除质量 |

重量把静止的软带再拉长一截已经发生：正下方平衡时伸长约 `GRAVITY / ARM_RATE²`。不要再把悬挂收成定长圆。
