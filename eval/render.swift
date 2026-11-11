// 把 eval/dataset.json 里每张小票的印刷行渲染成 JPEG(确定性: 固定随机种子)。
// 用法: swiftc -O eval/render.swift -o /tmp/render && /tmp/render eval/dataset.json eval/images
import AppKit
import CoreImage

struct RNG { var s: UInt64
  mutating func next() -> Double { s = s &* 6364136223846793005 &+ 1442695040888963407; return Double((s >> 33) & 0xFFFFFF) / Double(0x1000000) } }

func render(_ rec: [String: Any], outDir: String) {
  let id = rec["id"] as! String
  let width = CGFloat((rec["width"] as? Double) ?? 520)
  let fontName = (rec["font"] as? String) ?? "Menlo-Regular"
  let fx = (rec["effects"] as? [String: Any]) ?? [:]
  let lines = rec["lines"] as! [[String: Any]]
  let scale: CGFloat = 2
  let base: CGFloat = 19 * (width / 520)
  let margin: CGFloat = 26
  let paperGray: CGFloat = 0.98
  let contrast = CGFloat((fx["contrast"] as? Double) ?? 1.0)
  let ink = NSColor(white: 0.08 + (1 - contrast) * 0.5, alpha: 1)

  func font(_ size: CGFloat, bold: Bool) -> NSFont {
    if bold, let f = NSFont(name: fontName.replacingOccurrences(of: "Regular", with: "Bold"), size: size) { return f }
    return NSFont(name: fontName, size: size) ?? NSFont.monospacedSystemFont(ofSize: size, weight: bold ? .bold : .regular)
  }
  // 先量高度
  var y: CGFloat = 30
  var heights: [CGFloat] = []
  for ln in lines { let s = CGFloat((ln["s"] as? Double) ?? 1.0); let h = base * s * 1.55 + CGFloat((ln["gap"] as? Double) ?? 0); heights.append(h); y += h }
  let paperH = y + 30
  let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(width * scale), pixelsHigh: Int(paperH * scale), bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
  let ctx = NSGraphicsContext(bitmapImageRep: rep)!
  NSGraphicsContext.current = ctx
  ctx.cgContext.scaleBy(x: scale, y: scale)
  NSColor(white: paperGray, alpha: 1).setFill()
  NSRect(x: 0, y: 0, width: width, height: paperH).fill()
  var cy = paperH - 30
  for (i, ln) in lines.enumerated() {
    let s = CGFloat((ln["s"] as? Double) ?? 1.0)
    let bold = (ln["b"] as? Bool) ?? false
    let f = font(base * s, bold: bold)
    let attrs: [NSAttributedString.Key: Any] = [.font: f, .foregroundColor: ink]
    cy -= heights[i]
    let ty = cy + CGFloat((ln["gap"] as? Double) ?? 0) * 0
    let l = (ln["l"] as? String) ?? ""
    let r = ln["r"] as? String
    let align = (ln["align"] as? String) ?? "l"
    let ls = NSAttributedString(string: l, attributes: attrs)
    if align == "c" { ls.draw(at: NSPoint(x: (width - ls.size().width) / 2, y: ty)) }
    else { ls.draw(at: NSPoint(x: margin, y: ty)) }
    if let r = r { let rs = NSAttributedString(string: r, attributes: attrs); rs.draw(at: NSPoint(x: width - margin - rs.size().width, y: ty)) }
  }
  NSGraphicsContext.current = nil
  var img = CIImage(bitmapImageRep: rep)!
  var rng = RNG(s: UInt64(id.utf8.reduce(UInt32(2166136261)) { ($0 &* 16777619) ^ UInt32($1) }))
  let ci = CIContext()
  let extent0 = img.extent

  if let b = fx["blur"] as? Double, b > 0 { img = img.clampedToExtent().applyingGaussianBlur(sigma: b * Double(scale)).cropped(to: extent0) }
  if let l = fx["light"] as? Double, l > 0 {
    // 不均匀光照: 左上亮右下暗的线性渐变叠乘
    let g = CIFilter(name: "CILinearGradient", parameters: ["inputPoint0": CIVector(x: 0, y: extent0.height), "inputPoint1": CIVector(x: extent0.width, y: 0),
      "inputColor0": CIColor(red: 1, green: 1, blue: 1), "inputColor1": CIColor(red: 1 - l, green: 1 - l, blue: 1 - l)])!.outputImage!.cropped(to: extent0)
    img = CIFilter(name: "CIMultiplyCompositing", parameters: [kCIInputImageKey: g, kCIInputBackgroundImageKey: img])!.outputImage!
  }
  if let n = fx["noise"] as? Double, n > 0 {
    let noise = CIFilter(name: "CIRandomGenerator")!.outputImage!.cropped(to: extent0)
    let gray = CIFilter(name: "CIColorMatrix", parameters: [kCIInputImageKey: noise, "inputRVector": CIVector(x: n, y: 0, z: 0, w: 0), "inputGVector": CIVector(x: n, y: 0, z: 0, w: 0), "inputBVector": CIVector(x: n, y: 0, z: 0, w: 0), "inputAVector": CIVector(x: 0, y: 0, z: 0, w: 0), "inputBiasVector": CIVector(x: -n / 2, y: -n / 2, z: -n / 2, w: 1)])!.outputImage!
    img = CIFilter(name: "CIAdditionCompositing", parameters: [kCIInputImageKey: gray, kCIInputBackgroundImageKey: img])!.outputImage!.cropped(to: extent0)
  }
  var cg = ci.createCGImage(img, from: extent0)!

  // 旋转/透视 + 桌面背景
  let rot = (fx["rotate"] as? Double) ?? 0
  let persp = (fx["persp"] as? Double) ?? 0
  let desk = (fx["desk"] as? Bool) ?? false
  if rot != 0 || persp != 0 || desk {
    let w = CGFloat(cg.width), h = CGFloat(cg.height)
    let pad: CGFloat = desk ? 140 : 60
    let W = Int(w + pad * 2), H = Int(h + pad * 2)
    let cs = CGColorSpaceCreateDeviceRGB()
    let c = CGContext(data: nil, width: W, height: H, bitsPerComponent: 8, bytesPerRow: 0, space: cs, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    if desk { c.setFillColor(CGColor(red: 0.30, green: 0.22, blue: 0.16, alpha: 1)) } else { c.setFillColor(CGColor(gray: 0.97, alpha: 1)) }
    c.fill(CGRect(x: 0, y: 0, width: W, height: H))
    if desk { // 木纹条
      for k in 0..<40 { let yy = CGFloat(k) * CGFloat(H) / 40; c.setFillColor(CGColor(red: 0.30 + CGFloat(rng.next()) * 0.05, green: 0.22, blue: 0.16, alpha: 1)); c.fill(CGRect(x: 0, y: yy, width: CGFloat(W), height: 2)) }
    }
    c.translateBy(x: CGFloat(W) / 2, y: CGFloat(H) / 2)
    c.rotate(by: CGFloat(rot) * .pi / 180)
    if desk { c.setShadow(offset: CGSize(width: 6, height: -8), blur: 18, color: CGColor(gray: 0, alpha: 0.6)) }
    c.draw(cg, in: CGRect(x: -w / 2, y: -h / 2, width: w, height: h))
    cg = c.makeImage()!
    if persp != 0 {
      var ci2 = CIImage(cgImage: cg)
      let e = ci2.extent; let d = CGFloat(persp) * e.width
      ci2 = CIFilter(name: "CIPerspectiveTransform", parameters: [kCIInputImageKey: ci2,
        "inputTopLeft": CIVector(x: e.minX + d, y: e.maxY - d), "inputTopRight": CIVector(x: e.maxX - d, y: e.maxY), "inputBottomLeft": CIVector(x: e.minX, y: e.minY), "inputBottomRight": CIVector(x: e.maxX, y: e.minY + d)])!.outputImage!
      cg = ci.createCGImage(ci2, from: ci2.extent)!
    }
  }
  let outRep = NSBitmapImageRep(cgImage: cg)
  let q = (fx["jpeg"] as? Double) ?? 0.82
  let data = outRep.representation(using: .jpeg, properties: [.compressionFactor: q])!
  try! data.write(to: URL(fileURLWithPath: outDir + "/" + id + ".jpg"))
  print(id, Int(cg.width), "x", Int(cg.height), data.count / 1024, "KB")
}

let args = CommandLine.arguments
let ds = try! JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: args[1]))) as! [String: Any]
for rec in ds["receipts"] as! [[String: Any]] { render(rec, outDir: args[2]) }
