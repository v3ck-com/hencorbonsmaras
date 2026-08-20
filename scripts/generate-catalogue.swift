import AppKit
import CoreGraphics
import CoreText
import Foundation

struct Lot {
    let number: Int
    let bull: String
}

enum CatalogueError: Error, CustomStringConvertible {
    case missingAsset(String)
    case cannotCreatePDF(String)

    var description: String {
        switch self {
        case .missingAsset(let path):
            return "Missing asset: \(path)"
        case .cannotCreatePDF(let path):
            return "Cannot create PDF: \(path)"
        }
    }
}

let lots = [
    Lot(number: 1, bull: "HC240019"),
    Lot(number: 2, bull: "HC240003"),
    Lot(number: 3, bull: "HC240145"),
    Lot(number: 4, bull: "HC240079"),
    Lot(number: 5, bull: "HC240005"),
    Lot(number: 6, bull: "HC240007"),
    Lot(number: 7, bull: "HC230057 HH"),
    Lot(number: 8, bull: "HC230075"),
    Lot(number: 9, bull: "HC240109"),
    Lot(number: 10, bull: "HC240029"),
    Lot(number: 11, bull: "HC240035"),
    Lot(number: 12, bull: "HC240051"),
    Lot(number: 13, bull: "HC240137"),
    Lot(number: 14, bull: "HC240101"),
    Lot(number: 15, bull: "HC240123"),
    Lot(number: 16, bull: "HC240011"),
    Lot(number: 17, bull: "HC240023"),
    Lot(number: 18, bull: "HC240061"),
    Lot(number: 19, bull: "HC240083"),
    Lot(number: 20, bull: "HC240025"),
    Lot(number: 21, bull: "HC240139"),
    Lot(number: 22, bull: "HC240087"),
    Lot(number: 23, bull: "HC240133"),
    Lot(number: 24, bull: "HC240067"),
    Lot(number: 25, bull: "HC240085"),
]

let root = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
let assets = root.appendingPathComponent("assets")
let output = assets.appendingPathComponent("hencor-veilingskatalogus-2026.pdf")
let placeholderURL = assets.appendingPathComponent("bull-placeholder.svg")
let logoURL = assets.appendingPathComponent("logo.svg")
let pageSize = CGSize(width: 841.89, height: 595.28)
var mediaBox = CGRect(origin: .zero, size: pageSize)

let paper = NSColor(calibratedRed: 0.984, green: 0.973, blue: 0.945, alpha: 1)
let ink = NSColor(calibratedRed: 0.208, green: 0.145, blue: 0.122, alpha: 1)
let oxblood = NSColor(calibratedRed: 0.439, green: 0.251, blue: 0.184, alpha: 1)
let clay = NSColor(calibratedRed: 0.678, green: 0.412, blue: 0.298, alpha: 1)
let sage = NSColor(calibratedRed: 0.608, green: 0.667, blue: 0.533, alpha: 1)

func loadImage(_ url: URL) throws -> NSImage {
    guard let image = NSImage(contentsOf: url) else {
        throw CatalogueError.missingAsset(url.path)
    }
    return image
}

func bullImageURL(for lot: Lot) -> URL {
    let stem = String(format: "lot-%02d", lot.number)
    let directory = assets.appendingPathComponent("bull-images")
    let bullNumber = lot.bull.replacingOccurrences(of: " HH", with: "")

    for fileExtension in ["jpg", "jpeg", "png"] {
        let candidates = [
            directory.appendingPathComponent("\(bullNumber).\(fileExtension)"),
            directory.appendingPathComponent("\(stem).\(fileExtension)"),
        ]

        for candidate in candidates where FileManager.default.fileExists(atPath: candidate.path) {
            return candidate
        }
    }

    return placeholderURL
}

func aspectFit(_ size: NSSize, in bounds: CGRect) -> CGRect {
    let scale = min(bounds.width / size.width, bounds.height / size.height)
    let fitted = CGSize(width: size.width * scale, height: size.height * scale)
    return CGRect(
        x: bounds.midX - fitted.width / 2,
        y: bounds.midY - fitted.height / 2,
        width: fitted.width,
        height: fitted.height
    )
}

func drawImage(_ image: NSImage, in bounds: CGRect, context: CGContext) {
    let target = aspectFit(image.size, in: bounds)
    context.saveGState()
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(cgContext: context, flipped: false)
    image.draw(in: target, from: .zero, operation: .sourceOver, fraction: 1)
    NSGraphicsContext.restoreGraphicsState()
    context.restoreGState()
}

func drawCenteredText(
    _ text: String,
    font: NSFont,
    color: NSColor,
    centerX: CGFloat,
    baselineY: CGFloat,
    context: CGContext
) {
    let attributes: [NSAttributedString.Key: Any] = [
        .font: font,
        .foregroundColor: color,
    ]
    let line = CTLineCreateWithAttributedString(NSAttributedString(string: text, attributes: attributes))
    let bounds = CTLineGetBoundsWithOptions(line, [.useGlyphPathBounds])
    context.textMatrix = .identity
    context.textPosition = CGPoint(x: centerX - bounds.width / 2, y: baselineY)
    CTLineDraw(line, context)
}

guard let consumer = CGDataConsumer(url: output as CFURL) else {
    throw CatalogueError.cannotCreatePDF(output.path)
}

let metadata: [CFString: Any] = [
    kCGPDFContextTitle: "2026 Hencor Bonsmaras Veilingskatalogus",
    kCGPDFContextAuthor: "Hencor Bonsmaras",
    kCGPDFContextSubject: "25 Bonsmarabulle met lotinligting, stambome en teelsyfers",
    kCGPDFContextCreator: "Hencor Bonsmaras Catalogue Generator",
]

guard let context = CGContext(consumer: consumer, mediaBox: &mediaBox, metadata as CFDictionary) else {
    throw CatalogueError.cannotCreatePDF(output.path)
}

let logo = try loadImage(logoURL)
let placeholder = try loadImage(placeholderURL)

context.beginPDFPage(nil)
context.setFillColor(oxblood.cgColor)
context.fill(mediaBox)
context.setStrokeColor(sage.withAlphaComponent(0.28).cgColor)
context.setLineWidth(38)
context.strokeEllipse(in: CGRect(x: 650, y: 390, width: 270, height: 270))
context.setFillColor(clay.withAlphaComponent(0.25).cgColor)
context.fillEllipse(in: CGRect(x: -70, y: -80, width: 250, height: 250))

drawCenteredText(
    "HENCOR BONSMARAS",
    font: NSFont.systemFont(ofSize: 15, weight: .bold),
    color: paper,
    centerX: pageSize.width / 2,
    baselineY: 527,
    context: context
)
drawImage(logo, in: CGRect(x: 331, y: 284, width: 180, height: 180), context: context)
drawCenteredText(
    "2026 VEILINGSKATALOGUS",
    font: NSFont(name: "Georgia", size: 32) ?? NSFont.systemFont(ofSize: 32),
    color: paper,
    centerX: pageSize.width / 2,
    baselineY: 225,
    context: context
)
drawCenteredText(
    "25 BONSMARABULLE",
    font: NSFont.systemFont(ofSize: 13, weight: .bold),
    color: NSColor(calibratedWhite: 0.92, alpha: 1),
    centerX: pageSize.width / 2,
    baselineY: 184,
    context: context
)
drawCenteredText(
    "Veilingsdatum: 19 Augustus 2026",
    font: NSFont.systemFont(ofSize: 12, weight: .medium),
    color: paper,
    centerX: pageSize.width / 2,
    baselineY: 132,
    context: context
)
drawCenteredText(
    "hencorbonsmaras.co.za",
    font: NSFont.systemFont(ofSize: 10, weight: .medium),
    color: NSColor(calibratedWhite: 0.85, alpha: 1),
    centerX: pageSize.width / 2,
    baselineY: 58,
    context: context
)
context.endPDFPage()

for lot in lots {
    let lotNumber = String(format: "%02d", lot.number)
    let tableURL = assets.appendingPathComponent("katalogus-tables/lot-\(lotNumber).png")
    let table = try loadImage(tableURL)
    let bullImageURL = bullImageURL(for: lot)
    let bullImage = bullImageURL == placeholderURL ? placeholder : try loadImage(bullImageURL)

    context.beginPDFPage(nil)
    context.setFillColor(paper.cgColor)
    context.fill(mediaBox)

    context.setFillColor(oxblood.cgColor)
    context.fill(CGRect(x: 0, y: 542, width: pageSize.width, height: 53.28))
    drawCenteredText(
        "LOT \(lotNumber)  |  \(lot.bull)",
        font: NSFont.systemFont(ofSize: 18, weight: .bold),
        color: paper,
        centerX: pageSize.width / 2,
        baselineY: 558,
        context: context
    )

    let photoFrame = CGRect(x: 220, y: 256, width: 402, height: 268)
    context.setFillColor(ink.cgColor)
    context.addPath(CGPath(roundedRect: photoFrame.insetBy(dx: -7, dy: -7), cornerWidth: 14, cornerHeight: 14, transform: nil))
    context.fillPath()
    drawImage(bullImage, in: photoFrame, context: context)

    drawCenteredText(
        "STAMBOOM EN TEELSYFERS",
        font: NSFont.systemFont(ofSize: 9, weight: .bold),
        color: oxblood,
        centerX: pageSize.width / 2,
        baselineY: 226,
        context: context
    )

    let tableFrame = CGRect(x: 22, y: 46, width: 798, height: 167)
    context.setFillColor(NSColor.white.cgColor)
    context.fill(tableFrame.insetBy(dx: -2, dy: -2))
    drawImage(table, in: tableFrame, context: context)

    drawCenteredText(
        "Hencor Bonsmaras | hencorbonsmaras.co.za | Blad \(lot.number + 1) van \(lots.count + 1)",
        font: NSFont.systemFont(ofSize: 7.5, weight: .regular),
        color: ink.withAlphaComponent(0.72),
        centerX: pageSize.width / 2,
        baselineY: 19,
        context: context
    )
    context.endPDFPage()
}

context.closePDF()
print("Created \(output.path) with \(lots.count + 1) pages")
