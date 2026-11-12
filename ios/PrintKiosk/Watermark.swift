import UIKit
import PDFKit

/// The free version's mark: after the 10 free prints (or when the subscription lapses), every page
/// is redrawn into a new PDF with "imprime.ai" across it and a line at the foot of the page.
enum Watermark {
    /// A4 in points, used for photos (PDF pages keep their own size).
    private static let a4 = CGRect(x: 0, y: 0, width: 595.2, height: 841.8)
    private static let brand = UIColor(red: 79 / 255, green: 70 / 255, blue: 229 / 255, alpha: 1)

    /// Same items, each turned into a watermarked PDF. Anything that can't be read is passed through.
    static func apply(to items: [Any]) -> [Any] {
        items.map { item in
            if let image = item as? UIImage, let data = pdf(from: image) { return data }
            if let url = item as? URL, let document = PDFDocument(url: url), let data = pdf(from: document) { return data }
            if let data = item as? Data, let document = PDFDocument(data: data), let data = pdf(from: document) { return data }
            return item
        }
    }

    private static func pdf(from image: UIImage) -> Data? {
        let landscape = image.size.width > image.size.height
        let page = landscape ? CGRect(x: 0, y: 0, width: a4.height, height: a4.width) : a4
        let renderer = UIGraphicsPDFRenderer(bounds: page)
        return renderer.pdfData { context in
            context.beginPage()
            let margin: CGFloat = 18
            let area = page.insetBy(dx: margin, dy: margin)
            let scale = min(area.width / image.size.width, area.height / image.size.height)
            let size = CGSize(width: image.size.width * scale, height: image.size.height * scale)
            image.draw(in: CGRect(x: area.midX - size.width / 2, y: area.midY - size.height / 2,
                                  width: size.width, height: size.height))
            stamp(context.cgContext, in: page)
        }
    }

    private static func pdf(from document: PDFDocument) -> Data? {
        guard document.pageCount > 0, let first = document.page(at: 0) else { return nil }
        let renderer = UIGraphicsPDFRenderer(bounds: first.bounds(for: .mediaBox))
        return renderer.pdfData { context in
            for index in 0..<document.pageCount {
                guard let page = document.page(at: index) else { continue }
                let box = page.bounds(for: .mediaBox)
                let rotated = page.rotation % 180 != 0
                let bounds = rotated ? CGRect(x: 0, y: 0, width: box.height, height: box.width) : CGRect(origin: .zero, size: box.size)
                context.beginPage(withBounds: bounds, pageInfo: [:])
                let cg = context.cgContext
                cg.saveGState()
                // PDFKit draws in PDF space (origin bottom-left); UIKit's context is flipped.
                cg.translateBy(x: 0, y: bounds.height)
                cg.scaleBy(x: 1, y: -1)
                page.draw(with: .mediaBox, to: cg)
                cg.restoreGState()
                stamp(cg, in: bounds)
            }
        }
    }

    /// Big diagonal "imprime.ai" in light indigo, plus a small line at the bottom.
    private static func stamp(_ cg: CGContext, in page: CGRect) {
        let big = NSAttributedString(string: "imprime.ai", attributes: [
            .font: UIFont.systemFont(ofSize: min(page.width, page.height) * 0.17, weight: .heavy),
            .foregroundColor: brand.withAlphaComponent(0.16),
        ])
        let size = big.size()
        cg.saveGState()
        cg.translateBy(x: page.midX, y: page.midY)
        cg.rotate(by: -.pi / 5)
        big.draw(at: CGPoint(x: -size.width / 2, y: -size.height / 2))
        cg.restoreGState()

        let foot = NSAttributedString(string: "Impresso na versão gratuita do imprime.ai · imprime.ai", attributes: [
            .font: UIFont.systemFont(ofSize: 8, weight: .semibold),
            .foregroundColor: UIColor(white: 0.2, alpha: 0.75),
        ])
        let footSize = foot.size()
        foot.draw(at: CGPoint(x: page.midX - footSize.width / 2, y: page.maxY - footSize.height - 6))
    }
}
