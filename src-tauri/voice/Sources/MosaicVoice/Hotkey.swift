import AppKit
import CoreGraphics

/// Watches the fn (globe) key system-wide, like Wispr Flow (Windows uses Right Alt):
/// - hold: talk, let go to paste
/// - double-tap: hands-free; tap again to paste
/// - any other key while holding it cancels, so fn shortcuts keep working
/// The fn press itself is not passed on, so macOS's globe actions (emoji picker) don't fire.
/// Needs Accessibility permission; without it nothing reaches us.
final class FnKey {
    enum Action { case startHold, finish, cancel, becomeHandsFree }
    var onAction: ((Action) -> Void)?

    private enum State { case idle, holding(since: Date), tapped(at: Date), handsFree }
    private var state: State = .idle
    private var fnDown = false
    private var tap: CFMachPort?
    private var tapTimer: Timer?

    static let holdThreshold: TimeInterval = 0.25    // shorter than this counts as a tap
    static let doubleTapWindow: TimeInterval = 0.35   // second tap must start within this

    var isActive: Bool {
        if case .idle = state { return false }
        return true
    }

    func reset() { state = .idle; tapTimer?.invalidate() }

    /// Returns false if macOS has not granted Accessibility yet.
    @discardableResult
    func start() -> Bool {
        let mask = (1 << CGEventType.flagsChanged.rawValue) | (1 << CGEventType.keyDown.rawValue)
        let me = Unmanaged.passUnretained(self).toOpaque()
        guard let tap = CGEvent.tapCreate(
            tap: .cgSessionEventTap, place: .headInsertEventTap, options: .defaultTap,
            eventsOfInterest: CGEventMask(mask),
            callback: { _, type, event, refcon in
                let me = Unmanaged<FnKey>.fromOpaque(refcon!).takeUnretainedValue()
                return me.handle(type, event)
            }, userInfo: me)
        else { return false }
        self.tap = tap
        let src = CFMachPortCreateRunLoopSource(nil, tap, 0)
        CFRunLoopAddSource(CFRunLoopGetMain(), src, .commonModes)
        CGEvent.tapEnable(tap: tap, enable: true)
        return true
    }

    private func handle(_ type: CGEventType, _ event: CGEvent) -> Unmanaged<CGEvent>? {
        if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
            if let tap { CGEvent.tapEnable(tap: tap, enable: true) }
            return Unmanaged.passUnretained(event)
        }
        if type == .keyDown {
            let key = event.getIntegerValueField(.keyboardEventKeycode)
            // The globe key also sends its own key event (179); that is the fn key itself,
            // not another key, and it is what opens the emoji picker. Swallow it.
            if key == 179 || key == 63 { return nil }
            switch state {
            case .holding, .tapped:
                // fn was being used as a modifier: give the shortcut back to macOS.
                Events.log("cancel: other key \(key) pressed while fn down")
                state = .idle; tapTimer?.invalidate(); fire(.cancel)
            case .handsFree where key == 53: // Esc throws a hands-free dictation away
                state = .idle; fire(.cancel)
                return nil
            default: break
            }
            return Unmanaged.passUnretained(event)
        }
        // flagsChanged
        let keycode = event.getIntegerValueField(.keyboardEventKeycode)
        guard keycode == 63 || keycode == 179 else { return Unmanaged.passUnretained(event) } // fn / globe
        let down = event.flags.contains(.maskSecondaryFn)
        if down == fnDown { return nil }
        fnDown = down
        down ? pressed() : released()
        return nil
    }

    private func pressed() {
        let now = Date()
        switch state {
        case .idle:
            state = .holding(since: now); fire(.startHold)
        case .tapped(let at) where now.timeIntervalSince(at) <= FnKey.doubleTapWindow:
            tapTimer?.invalidate(); state = .handsFree; fire(.becomeHandsFree)
        case .tapped:
            Events.log("cancel: second press came too late for a double-tap")
            tapTimer?.invalidate(); state = .holding(since: now); fire(.cancel); fire(.startHold)
        case .handsFree:
            state = .idle; fire(.finish)
        case .holding:
            break
        }
    }

    private func released() {
        guard case .holding(let since) = state else { return }
        let now = Date()
        Events.log(String(format: "fn released after %.2fs", now.timeIntervalSince(since)))
        if now.timeIntervalSince(since) >= FnKey.holdThreshold {
            state = .idle; fire(.finish)
        } else {
            // A quick tap: wait to see if a second tap makes it hands-free.
            state = .tapped(at: now)
            tapTimer?.invalidate()
            tapTimer = Timer.scheduledTimer(withTimeInterval: FnKey.doubleTapWindow, repeats: false) { [weak self] _ in
                guard let self, case .tapped = self.state else { return }
                Events.log("cancel: single short tap (no second tap)")
                self.state = .idle; self.fire(.cancel)
            }
        }
    }

    private func fire(_ a: Action) { onAction?(a) }
}

/// Puts text where the cursor is: through the clipboard and ⌘V, then restores what was on the clipboard.
enum Paster {
    static func paste(_ text: String) {
        let pb = NSPasteboard.general
        let saved: [NSPasteboardItem] = (pb.pasteboardItems ?? []).map { item in
            let copy = NSPasteboardItem()
            for t in item.types { if let d = item.data(forType: t) { copy.setData(d, forType: t) } }
            return copy
        }
        pb.clearContents()
        pb.setString(text, forType: .string)
        let ours = pb.changeCount
        let src = CGEventSource(stateID: .combinedSessionState)
        let v: CGKeyCode = 9
        let down = CGEvent(keyboardEventSource: src, virtualKey: v, keyDown: true)
        let up = CGEvent(keyboardEventSource: src, virtualKey: v, keyDown: false)
        down?.flags = .maskCommand; up?.flags = .maskCommand
        down?.post(tap: .cgSessionEventTap); up?.post(tap: .cgSessionEventTap)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) {
            guard pb.changeCount == ours else { return } // something else copied meanwhile; leave it
            pb.clearContents()
            if !saved.isEmpty { pb.writeObjects(saved) }
        }
    }
}
