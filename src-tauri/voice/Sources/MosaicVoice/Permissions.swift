import AppKit
import AVFoundation
import ApplicationServices

/// Checked and requested from Mosaic's setup screen, so people grant everything once, in one place.
/// The helper holds these permissions itself (macOS treats it as its own program).
enum Permissions {
    static let systemAudioKey = "systemAudioAsked"

    static func handle(kind: String, request: Bool) {
        switch kind {
        case "microphone":
            let status = AVCaptureDevice.authorizationStatus(for: .audio)
            Events.log("perm microphone request=\(request) status=\(status.rawValue) (0 ask,1 restricted,2 denied,3 allowed)")
            if request && status == .notDetermined {
                DispatchQueue.main.async { NSApp.activate(ignoringOtherApps: true) }
                AVCaptureDevice.requestAccess(for: .audio) { ok in Events.log("perm microphone answered \(ok)"); reply(kind, ok) }
                return
            }
            if request && status == .denied {
                NSWorkspace.shared.open(URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone")!)
            }
            reply(kind, status == .authorized)
        case "accessibility":
            if request && !AXIsProcessTrusted() {
                let opts = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
                _ = AXIsProcessTrustedWithOptions(opts)
                NSWorkspace.shared.open(URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")!)
            }
            reply(kind, AXIsProcessTrusted())
        case "systemAudio":
            // macOS has no public check for this one. Starting a tap shows the prompt; once it has
            // been answered we remember that, and meeting notes say so if the other side is missing.
            if request {
                let tap = SystemAudio()
                do {
                    try tap.start()
                    DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
                        tap.stop()
                        UserDefaults.standard.set(true, forKey: systemAudioKey)
                        reply(kind, true)
                    }
                } catch {
                    Events.log("system audio request failed: \(error)")
                    reply(kind, false)
                }
                return
            }
            reply(kind, UserDefaults.standard.bool(forKey: systemAudioKey))
        default:
            reply(kind, false)
        }
    }

    private static func reply(_ kind: String, _ granted: Bool) {
        Events.send("perm", ["kind": kind, "granted": granted])
    }
}
