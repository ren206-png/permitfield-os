import UIKit
import Capacitor

// The app's root screen (Main.storyboard): Capacitor's web view, plus the
// app's own native plugins registered with the bridge.
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(DocumentScannerPlugin())
    }
}
