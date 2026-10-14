import UIKit
import Capacitor

/// Registers local plugins and locks portrait orientation.
@objc(BridgeViewController)
final class BridgeViewController: CAPBridgeViewController {
    override var supportedInterfaceOrientations: UIInterfaceOrientationMask {
        .portrait
    }

    override var preferredInterfaceOrientationForPresentation: UIInterfaceOrientation {
        .portrait
    }

    override var shouldAutorotate: Bool {
        false
    }

    /// First swipe up from the bottom edge goes to the game. The next one goes home.
    override var preferredScreenEdgesDeferringSystemGestures: UIRectEdge {
        .bottom
    }

    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        bridge?.registerPluginInstance(AdvancedHapticsPlugin())
        CAPLog.print("⚡️ AdvancedHapticsPlugin registered")
    }
}
