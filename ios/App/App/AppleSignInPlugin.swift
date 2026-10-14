import UIKit
import Capacitor
import AuthenticationServices
import CryptoKit

// "Continue with Apple" in the iPhone app: Apple's native sheet (Face ID),
// then the page signs in to Supabase with the identity token
// (supabase.auth.signInWithIdToken, provider "apple", with the raw nonce).
// Called from the site as window.Capacitor.Plugins.AppleSignIn
// (app/login/login-form.tsx).
@objc(AppleSignInPlugin)
public class AppleSignInPlugin: CAPPlugin, CAPBridgedPlugin, ASAuthorizationControllerDelegate,
    ASAuthorizationControllerPresentationContextProviding {
    public let identifier = "AppleSignInPlugin"
    public let jsName = "AppleSignIn"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "signIn", returnType: CAPPluginReturnPromise),
    ]

    private var pendingCall: CAPPluginCall?
    private var rawNonce: String?

    @objc func signIn(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard self.pendingCall == nil else {
                call.reject("Sign in with Apple is already open.", "BUSY")
                return
            }
            let nonce = Self.randomNonce()
            self.pendingCall = call
            self.rawNonce = nonce

            let request = ASAuthorizationAppleIDProvider().createRequest()
            request.requestedScopes = [.fullName, .email]
            // Apple signs the hash; Supabase checks it against the raw nonce.
            request.nonce = Self.sha256(nonce)

            let controller = ASAuthorizationController(authorizationRequests: [request])
            controller.delegate = self
            controller.presentationContextProvider = self
            controller.performRequests()
        }
    }

    public func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        bridge?.viewController?.view.window ?? ASPresentationAnchor()
    }

    public func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
        defer { pendingCall = nil; rawNonce = nil }
        guard let call = pendingCall else { return }
        guard
            let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
            let tokenData = credential.identityToken,
            let token = String(data: tokenData, encoding: .utf8),
            let nonce = rawNonce
        else {
            call.reject("Apple didn't return a sign-in token.", "NO_TOKEN")
            return
        }
        // Apple shares the name only on the first sign-in; the page saves it.
        call.resolve([
            "identityToken": token,
            "nonce": nonce,
            "givenName": credential.fullName?.givenName ?? "",
            "familyName": credential.fullName?.familyName ?? "",
        ])
    }

    public func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
        defer { pendingCall = nil; rawNonce = nil }
        guard let call = pendingCall else { return }
        if let authError = error as? ASAuthorizationError, authError.code == .canceled {
            call.resolve(["cancelled": true])
        } else {
            call.reject("Sign in with Apple didn't work: \(error.localizedDescription)", "FAILED")
        }
    }

    private static func randomNonce(length: Int = 32) -> String {
        let charset = Array("0123456789ABCDEFGHIJKLMNOPQRSTUVXYZabcdefghijklmnopqrstuvwxyz-._")
        var bytes = [UInt8](repeating: 0, count: length)
        _ = SecRandomCopyBytes(kSecRandomDefault, length, &bytes)
        return String(bytes.map { charset[Int($0) % charset.count] })
    }

    private static func sha256(_ input: String) -> String {
        SHA256.hash(data: Data(input.utf8)).map { String(format: "%02x", $0) }.joined()
    }
}
