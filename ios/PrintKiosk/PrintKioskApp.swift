import SwiftUI

@main
struct PrintKioskApp: App {
    @StateObject private var store = KioskStore()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(store)
                // Records every touch anywhere in the window so the idle timer can reset the kiosk.
                .background(
                    TouchTrackerInstaller { store.registerInteraction() }
                        .allowsHitTesting(false)
                )
                .onAppear {
                    // Keep the screen awake while the kiosk is running.
                    UIApplication.shared.isIdleTimerDisabled = true
                }
        }
    }
}
