import SwiftUI
import UIKit
import UIKit.UIGestureRecognizerSubclass

/// A gesture recognizer that never recognizes anything. It only reports that a touch began,
/// so the kiosk knows someone is still using it. It never blocks or delays other touches.
final class TouchTracker: UIGestureRecognizer {
    var onTouch: (() -> Void)?

    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent) {
        onTouch?()
        state = .failed
    }
}

/// Invisible view that attaches a TouchTracker to its window once it appears on screen.
struct TouchTrackerInstaller: UIViewRepresentable {
    let onTouch: () -> Void

    func makeUIView(context: Context) -> InstallerView {
        let view = InstallerView()
        view.onTouch = onTouch
        return view
    }

    func updateUIView(_ uiView: InstallerView, context: Context) {
        uiView.onTouch = onTouch
    }

    final class InstallerView: UIView {
        var onTouch: (() -> Void)?
        private weak var installedWindow: UIWindow?

        override func didMoveToWindow() {
            super.didMoveToWindow()
            guard let window, window !== installedWindow else { return }

            let tracker = TouchTracker(target: nil, action: nil)
            tracker.cancelsTouchesInView = false
            tracker.delaysTouchesBegan = false
            tracker.delaysTouchesEnded = false
            tracker.onTouch = { [weak self] in self?.onTouch?() }

            window.addGestureRecognizer(tracker)
            installedWindow = window
        }
    }
}
