import AppKit
import PDFKit
import Foundation

enum ExtractionError: Error, CustomStringConvertible {
    case cannotOpenPDF(String)
    case cannotRenderPage(Int)
    case cannotCropLot(Int)
    case cannotEncodeLot(Int)

    var description: String {
        switch self {
        case .cannotOpenPDF(let path):
            return "Cannot open PDF: \(path)"
        case .cannotRenderPage(let page):
            return "Cannot render PDF page \(page)"
        case .cannotCropLot(let lot):
            return "Cannot crop lot \(lot)"
        case .cannotEncodeLot(let lot):
            return "Cannot encode lot \(lot) as PNG"
        }
    }
}

let root = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
let source = root.appendingPathComponent("assets/Hencor Bonsmaras 23-09-2026.pdf")
let outputDirectory = root.appendingPathComponent("assets/katalogus-tables")
let renderSize = NSSize(width: 2525, height: 1786)
let rowRects = [
    CGRect(x: 84, y: 163, width: 2360, height: 490),
    CGRect(x: 84, y: 675, width: 2360, height: 493),
    CGRect(x: 84, y: 1191, width: 2360, height: 492),
]

guard let document = PDFDocument(url: source) else {
    throw ExtractionError.cannotOpenPDF(source.path)
}

for lot in 1...25 {
    let pageIndex = 4 + (lot - 1) / 3
    let rowIndex = (lot - 1) % 3

    guard let page = document.page(at: pageIndex) else {
        throw ExtractionError.cannotRenderPage(pageIndex + 1)
    }

    let image = page.thumbnail(of: renderSize, for: .cropBox)
    guard
        let tiff = image.tiffRepresentation,
        let bitmap = NSBitmapImageRep(data: tiff),
        let sourceImage = bitmap.cgImage
    else {
        throw ExtractionError.cannotRenderPage(pageIndex + 1)
    }

    guard let croppedImage = sourceImage.cropping(to: rowRects[rowIndex]) else {
        throw ExtractionError.cannotCropLot(lot)
    }

    let croppedBitmap = NSBitmapImageRep(cgImage: croppedImage)
    guard let png = croppedBitmap.representation(using: .png, properties: [:]) else {
        throw ExtractionError.cannotEncodeLot(lot)
    }

    let filename = String(format: "lot-%02d.png", lot)
    try png.write(to: outputDirectory.appendingPathComponent(filename))
}

print("Extracted 25 lot tables from \(source.lastPathComponent)")
