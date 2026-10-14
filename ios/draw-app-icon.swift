import AppKit
import CoreGraphics
import CoreText

// Draws PermitField's mark: a white bold "P" on the site's orange (#EA580C,
// Tailwind orange-600), as in the website header.
func render(size: Int, background: CGColor, markSide: CGFloat, rounded: Bool, path: String) {
    let space = CGColorSpaceCreateDeviceRGB()
    // No alpha channel: App Store icons must be opaque.
    let ctx = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0,
                        space: space, bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
    ctx.setFillColor(background)
    ctx.fill(CGRect(x: 0, y: 0, width: size, height: size))
    let orange = CGColor(red: 0xEA/255, green: 0x58/255, blue: 0x0C/255, alpha: 1)
    let origin = (CGFloat(size) - markSide) / 2
    let rect = CGRect(x: origin, y: origin, width: markSide, height: markSide)
    ctx.setFillColor(orange)
    if rounded {
        ctx.addPath(CGPath(roundedRect: rect, cornerWidth: markSide * 0.22, cornerHeight: markSide * 0.22, transform: nil))
        ctx.fillPath()
    } else {
        ctx.fill(rect)
    }
    // Centre the letter by its actual outline (glyph path bounds), not the
    // font's line metrics.
    let font = CTFontCreateWithName("SFPro-Bold" as CFString, markSide * 0.62, nil)
    let bold = CTFontCreateCopyWithSymbolicTraits(font, markSide * 0.62, nil, .traitBold, .traitBold) ?? font
    var unichar: UniChar = 0x50 // "P"
    var glyph: CGGlyph = 0
    CTFontGetGlyphsForCharacters(bold, &unichar, &glyph, 1)
    let glyphPath = CTFontCreatePathForGlyph(bold, glyph, nil)!
    let box = glyphPath.boundingBoxOfPath
    var move = CGAffineTransform(translationX: rect.midX - box.midX, y: rect.midY - box.midY)
    let centred = glyphPath.copy(using: &move)!
    ctx.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
    ctx.addPath(centred)
    ctx.fillPath()
    let image = ctx.makeImage()!
    let rep = NSBitmapImageRep(cgImage: image)
    try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: path))
}

let orange = CGColor(red: 0xEA/255, green: 0x58/255, blue: 0x0C/255, alpha: 1)
let light = CGColor(red: 0xFA/255, green: 0xFA/255, blue: 0xFA/255, alpha: 1)
// App icon: the whole square is the mark (iOS rounds the corners itself).
render(size: 1024, background: orange, markSide: 1024, rounded: false, path: "AppIcon-512@2x.png")
// Splash: the rounded mark, small, centred on the app's light background.
render(size: 2732, background: light, markSide: 360, rounded: true, path: "splash-2732x2732.png")
