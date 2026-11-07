import UIKit

/// Wraps AirPrint so the kiosk can print to a saved printer without showing the system print dialog.
final class PrintService {

    /// Quick check used before charging, so nobody pays for a job that can't print.
    @MainActor
    func isReachable(_ printerURL: URL) async -> Bool {
        await withCheckedContinuation { continuation in
            UIPrinter(url: printerURL).contactPrinter { reachable in
                continuation.resume(returning: reachable)
            }
        }
    }

    /// Prints the items to the saved printer. Copies are collated (A, B, A, B).
    func print(
        _ items: [Any],
        copies: Int,
        asPhoto: Bool,
        printerURL: URL,
        completion: @escaping (_ success: Bool, _ message: String?) -> Void
    ) {
        let printer = UIPrinter(url: printerURL)

        printer.contactPrinter { reachable in
            DispatchQueue.main.async {
                guard reachable else {
                    completion(false, "A impressora não está respondendo. Verifique se ela está ligada e no mesmo Wi-Fi, e tente de novo.")
                    return
                }

                let info = UIPrintInfo.printInfo()
                info.jobName = "Print Kiosk"
                info.outputType = asPhoto ? .photo : .general

                let controller = UIPrintInteractionController.shared
                controller.printInfo = info
                controller.printingItems = Array(repeating: items, count: max(1, copies)).flatMap { $0 }

                var finished = false
                let started = controller.print(to: printer) { _, completed, error in
                    guard !finished else { return }
                    finished = true
                    if let error {
                        completion(false, error.localizedDescription)
                    } else if completed {
                        completion(true, nil)
                    } else {
                        completion(false, "A impressão foi cancelada.")
                    }
                }

                if !started && !finished {
                    finished = true
                    completion(false, "Este item não pode ser impresso. Tente outra foto ou outro PDF.")
                }
            }
        }
    }

    /// Shows the system printer picker (used from the staff settings screen).
    func pickPrinter(completion: @escaping (_ url: URL?, _ name: String?) -> Void) {
        guard let host = UIApplication.shared.topViewController?.view else {
            completion(nil, nil)
            return
        }

        let picker = UIPrinterPickerController(initiallySelectedPrinter: nil)
        let anchor = CGRect(x: host.bounds.midX, y: host.bounds.midY, width: 1, height: 1)

        picker.present(from: anchor, in: host, animated: true) { picker, selected, _ in
            guard selected, let printer = picker.selectedPrinter else {
                completion(nil, nil)
                return
            }
            completion(printer.url, printer.displayName)
        }
    }
}

extension UIApplication {
    /// The view controller currently on top, so popovers appear above sheets and full-screen covers.
    var topViewController: UIViewController? {
        let scene = connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .first { $0.activationState == .foregroundActive }
            ?? connectedScenes.compactMap { $0 as? UIWindowScene }.first
        var top = scene?.windows.first(where: \.isKeyWindow)?.rootViewController
        while let presented = top?.presentedViewController {
            top = presented
        }
        return top
    }
}
