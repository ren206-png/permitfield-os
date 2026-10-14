import UIKit
import Capacitor
import VisionKit
import PDFKit

// "Scan with camera" on an application's Documents panel: opens Apple's
// document camera (edge detection, perspective correction), then returns
// every scanned page as one PDF, base64-encoded, for the web page to upload
// through its normal upload form. Called from the site as
// window.Capacitor.Plugins.DocumentScanner (see
// app/(app)/applications/[id]/document-upload.tsx).
@objc(DocumentScannerPlugin)
public class DocumentScannerPlugin: CAPPlugin, CAPBridgedPlugin, VNDocumentCameraViewControllerDelegate {
    public let identifier = "DocumentScannerPlugin"
    public let jsName = "DocumentScanner"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "scan", returnType: CAPPluginReturnPromise),
    ]

    // Scans are embedded as JPEG at this size: sharp enough to read a
    // drawing's dimensions, small enough to stay well under the 25 MB upload cap.
    private static let maxPixelLength: CGFloat = 2400
    private static let jpegQuality: CGFloat = 0.7

    private var pendingCall: CAPPluginCall?

    @objc func isAvailable(_ call: CAPPluginCall) {
        call.resolve(["available": VNDocumentCameraViewController.isSupported])
    }

    @objc func scan(_ call: CAPPluginCall) {
        guard VNDocumentCameraViewController.isSupported else {
            call.reject("Document scanning isn't available on this device.", "UNAVAILABLE")
            return
        }
        DispatchQueue.main.async {
            guard self.pendingCall == nil else {
                call.reject("A scan is already open.", "BUSY")
                return
            }
            self.pendingCall = call
            let scanner = VNDocumentCameraViewController()
            scanner.delegate = self
            self.bridge?.viewController?.present(scanner, animated: true)
        }
    }

    public func documentCameraViewController(_ controller: VNDocumentCameraViewController, didFinishWith scan: VNDocumentCameraScan) {
        controller.dismiss(animated: true)
        guard let call = pendingCall else { return }
        pendingCall = nil

        let pdf = PDFDocument()
        for index in 0..<scan.pageCount {
            if let image = Self.compressed(scan.imageOfPage(at: index)), let page = PDFPage(image: image) {
                pdf.insert(page, at: pdf.pageCount)
            }
        }
        guard pdf.pageCount > 0, let data = pdf.dataRepresentation() else {
            call.reject("The scan couldn't be saved as a PDF.", "PDF_FAILED")
            return
        }
        call.resolve(["base64": data.base64EncodedString(), "pageCount": pdf.pageCount, "byteSize": data.count])
    }

    public func documentCameraViewControllerDidCancel(_ controller: VNDocumentCameraViewController) {
        controller.dismiss(animated: true)
        pendingCall?.resolve(["cancelled": true])
        pendingCall = nil
    }

    public func documentCameraViewController(_ controller: VNDocumentCameraViewController, didFailWithError error: Error) {
        controller.dismiss(animated: true)
        pendingCall?.reject("The camera couldn't scan: \(error.localizedDescription)", "SCAN_FAILED")
        pendingCall = nil
    }

    private static func compressed(_ image: UIImage) -> UIImage? {
        let longest = max(image.size.width, image.size.height)
        let scale = longest > maxPixelLength ? maxPixelLength / longest : 1
        let size = CGSize(width: image.size.width * scale, height: image.size.height * scale)
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let resized = UIGraphicsImageRenderer(size: size, format: format).image { _ in
            image.draw(in: CGRect(origin: .zero, size: size))
        }
        guard let jpeg = resized.jpegData(compressionQuality: jpegQuality) else { return nil }
        return UIImage(data: jpeg)
    }
}
