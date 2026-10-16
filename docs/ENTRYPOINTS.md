# 入口与调用链

## 1. 命令

| 命令 | 结果 |
|------|------|
| `npm run dev` | http://127.0.0.1:5207/ |
| `npm run build` | `tsc` 检查 + `dist/`（相对路径） |
| `npm run cap:sync` | build + cap sync ios |
| `npm run ios:bootstrap` | add ios + 拷插件 + 改 storyboard **和 SceneDelegate** + pbx + sync |
| `npm run ios` | sync + open Xcode |

## 2. Web 启动链

```
index.html
  → style.css
  → main.ts
       → applyNativeClass / safeArea
       → createRenderer(#stage)
       → game/sling.ts + game/pegs.ts（feel 在 game/tune.ts，面板 game/tunePanel.ts）
       → mountDevicePreview → computeStageLayout → applyStageTransform
       → watchStageLayout
       → 指针：#stage 盒子 → 设计坐标 → pointerToWorld → tryBeginDrag / dragTo / endDrag
```

震动玩法在 `src/game/feelHaptics.ts`，经 `src/utils/haptics.ts` 进原生插件。参数在 `tune.ts` 的 `haptic`。真机接入见 [HAPTICS.md](./HAPTICS.md) §0，四处规则见 §8。拉射页没有单独的「点我震动」按钮。

## 3. DOM

```
#shell
  #viewport
    #app
      #stage
        canvas
        #ui-root
#device-switcher / #device-label   (web only)
```

## 4. iOS

震动插件 **不会**随 `cap:sync` 自动注册。第一次 / 改插件必须 `ios:bootstrap`。步骤见 [HAPTICS.md §0](./HAPTICS.md)。

```
ios:bootstrap
  → 拷 plugins/native-haptics → ios/App/App
  → Main.storyboard customClass = BridgeViewController
  → SceneDelegate.rootViewController = BridgeViewController()   ← Capacitor 8 必改
Xcode Run 真机
  → SceneDelegate 创建 BridgeViewController
  → capacitorDidLoad → registerPluginInstance(AdvancedHapticsPlugin)
  → load App/public (= dist)
  → 同上 Web 链
```

插件没注册时，真机上拉和抓也没有震动。`isPluginAvailable('AdvancedHaptics') === false` 表示仍在默认 `CAPBridgeViewController`。当前拉射页没有状态 HUD。

## 5. 改配置找谁

| 要改 | 文件 |
|------|------|
| base / 端口 | `vite.config.ts` |
| appId | `capacitor.config.ts` |
| 设计分辨率 | `design.ts` + `style.css` |
| 震动原生 | `plugins/native-haptics/*.swift` + bootstrap |
| 玩法震动 | `src/game/feelHaptics.ts` · `tune.ts` 的 `hapticDefaults` · [HAPTICS.md](./HAPTICS.md) §8 |
| 启动 HUD | `index.html` + `main.ts` |
| 现行物理和默认数 | [PHYSICS-PLAN.md](./PHYSICS-PLAN.md) · `src/game/tune.ts` |
| 调参面板 | `src/game/tunePanel.ts` |
| 拉射范围 | [MVP-PLAN.md](./MVP-PLAN.md) |
| 和原作的对照 | [SLING-KONG-FEEL.md](./SLING-KONG-FEEL.md) |
| 音效（规划） | [AUDIO.md](./AUDIO.md) |
| 震动接线 | [HAPTICS.md](./HAPTICS.md) |
