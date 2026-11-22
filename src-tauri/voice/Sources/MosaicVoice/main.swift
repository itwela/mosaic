import AppKit
import AVFoundation
import Foundation

/// Mosaic Voice: runs beside Mosaic, owns the fn key, the bubble and meeting notes.
/// Talks to Mosaic with JSON lines (stdout = events, stdin = commands).
final class Voice {
    let fn = FnKey()
    let bubble = Bubble()
    let card = Card()
    let watcher = MeetingWatcher()
    private let mic = Microphone()
    private var stream: SpeechStream?
    private var starting: Task<Void, Never>?
    private var meeting: MeetingRecorder?
    private var busy = false
    private var levelPeak: Float = 0
    private var chunkCount = 0

    func run() {
        bubble.model.onCancel = { [weak self] in self?.fn.reset(); self?.cancelDictation() }
        bubble.model.onStop = { [weak self] in self?.fn.reset(); self?.finishDictation() }
        bubble.model.onStopMeeting = { [weak self] in self?.stopMeeting() }
        fn.onAction = { [weak self] action in
            guard let self else { return }
            Events.log("key: \(action)")
            switch action {
            case .startHold: self.startDictation()
            case .becomeHandsFree: self.bubble.set(.handsFree)
            case .finish: self.finishDictation()
            case .cancel: self.cancelDictation()
            }
        }
        let tapOK = fn.start()
        Events.log("started; key listener \(tapOK ? "on" : "off") · accessibility=\(AXIsProcessTrusted()) listen=\(CGPreflightListenEventAccess()) post=\(CGPreflightPostEventAccess()) pid=\(getpid()) parent=\(getppid())")
        if !tapOK {
            Events.send("permission", ["name": "accessibility", "granted": false])
            // Keep trying: the event tap starts as soon as Accessibility is granted.
            Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] t in
                if self?.fn.start() == true {
                    t.invalidate()
                    Events.log("Accessibility granted; key listener on")
                    Events.send("permission", ["name": "accessibility", "granted": true])
                }
            }
        }
        watcher.onMeetingStarted = { [weak self] app in self?.askAboutMeeting(app) }
        watcher.onMeetingEnded = { [weak self] in self?.stopMeeting() }
        watcher.start()

        Task.detached {
            try? await SpeechStream.prepareAssets()
            Events.send("ready")
        }
        readCommands()
    }

    // MARK: dictation

    private func startDictation() {
        guard !busy, meeting == nil else { return }
        bubble.set(.listening)
        Events.log("dictation start · mic permission=\(AVCaptureDevice.authorizationStatus(for: .audio).rawValue) (3=allowed)")
        mic.onLevel = { [weak self] l in
            self?.levelPeak = max(self?.levelPeak ?? 0, l); self?.chunkCount += 1
            DispatchQueue.main.async { self?.bubble.model.push(level: l) }
        }
        // Open the mic first so nothing you say at the start is lost while the analyzer spins up.
        var early: [AVAudioPCMBuffer] = []
        let lock = NSLock()
        levelPeak = 0; chunkCount = 0
        mic.onBuffer = { b in lock.lock(); early.append(b); lock.unlock() }
        do { try mic.start() } catch {
            Events.log("mic failed: \(error)"); bubble.set(.nothing); return
        }
        starting = Task { [weak self] in
            guard let self else { return }
            do {
                let s = try await SpeechStream(timestamps: false)
                lock.lock()
                for b in early { s.feed(b) }
                early.removeAll()
                self.mic.onBuffer = { s.feed($0) }
                lock.unlock()
                self.stream = s
            } catch {
                Events.log("speech engine failed to start: \(error)")
            }
        }
    }

    private func finishDictation() {
        guard mic.running else { return }
        busy = true
        bubble.set(.writing)
        Task { [weak self] in
            guard let self else { return }
            await self.starting?.value
            self.mic.stop()
            let segments = await self.stream?.finish() ?? []
            self.stream = nil
            let raw = segments.map(\.text).joined(separator: " ").trimmingCharacters(in: .whitespacesAndNewlines)
            Events.log("dictation end · audio chunks=\(self.chunkCount) loudest=\(String(format: "%.2f", self.levelPeak)) speech stream=\(self.stream != nil || !segments.isEmpty) words=\(raw.split(separator: " ").count)")
            if raw.isEmpty {
                self.bubble.set(.nothing)
            } else {
                let clean = await Bridge.shared.cleanup(raw)
                await MainActor.run { Paster.paste(clean) }
                self.bubble.set(.ready)
            }
            self.busy = false
        }
    }

    private func cancelDictation() {
        guard mic.running else { bubble.set(.ready); return }
        mic.stop()
        Task { [weak self] in
            await self?.starting?.value
            await self?.stream?.cancel()
            self?.stream = nil
        }
        bubble.set(.ready)
    }

    // MARK: meetings

    private func askAboutMeeting(_ app: String) {
        card.show(CardView(tile: Glass.cobalt, title: "\(app) is using your mic", line: "Take notes for this meeting?",
                           primary: "Take notes", secondary: "Not now",
                           onPrimary: { [weak self] in self?.card.close(); self?.startMeeting(app) },
                           onSecondary: { [weak self] in self?.card.close() }),
                  hideAfter: 20)
    }

    func startMeeting(_ app: String) {
        guard meeting == nil else { return }
        if mic.running { cancelDictation(); fn.reset() }
        let rec = MeetingRecorder(app: app)
        rec.onLevel = { [weak self] l in DispatchQueue.main.async { self?.bubble.model.push(level: l) } }
        meeting = rec
        watcher.markRecording(app)
        Task { [weak self] in
            do {
                try await rec.start()
                self?.bubble.set(.meeting(started: rec.started))
                Events.send("meeting-started", ["app": app])
            } catch {
                Events.log("meeting failed to start: \(error)")
                self?.meeting = nil
                self?.watcher.clearRecording()
                self?.bubble.set(.ready)
            }
        }
    }

    func stopMeeting() {
        guard let rec = meeting else { return }
        meeting = nil
        watcher.clearRecording()
        bubble.set(.ready)
        Events.send("meeting-writing", [:])
        Task { [weak self] in
            guard let m = await rec.finish() else {
                Events.send("meeting-empty", [:]); return
            }
            Events.send("meeting-transcript", m)
            guard let saved = await Bridge.shared.waitForMeeting(m["id"] as! String) else { return }
            let mins = saved.minutes
            self?.card.show(CardView(tile: Glass.teal, title: "Notes are ready", line: "\(saved.title) · \(mins) min",
                                     link: "Open in Mosaic →",
                                     onPrimary: { [weak self] in
                                         self?.card.close()
                                         Events.send("open-meeting", ["id": saved.id])
                                     },
                                     onSecondary: { [weak self] in self?.card.close() }),
                            hideAfter: 30)
        }
    }

    // MARK: commands from Mosaic

    private func readCommands() {
        Thread.detachNewThread { [weak self] in
            while let line = readLine() {
                guard let data = line.data(using: .utf8),
                      let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                      let cmd = obj["cmd"] as? String else { continue }
                DispatchQueue.main.async {
                    switch cmd {
                    case "start-notes": self?.startMeeting((obj["app"] as? String) ?? "Meeting")
                    case "stop-notes": self?.stopMeeting()
                    case "paste": Bridge.shared.answer(id: obj["id"] as? Int ?? -1, text: obj["text"] as? String ?? "")
                    case "meeting-saved": Bridge.shared.meetingSaved(obj)
                    case "perm": Permissions.handle(kind: obj["kind"] as? String ?? "", request: obj["request"] as? Bool ?? false)
                    case "quit": NSApp.terminate(nil)
                    default: break
                    }
                }
            }
            // Mosaic closed our stdin: it quit, so we quit too.
            DispatchQueue.main.async { NSApp.terminate(nil) }
        }
    }
}

// Test hook: `mosaic-voice --transcribe <file.wav>` prints timestamped segments.
let args = CommandLine.arguments
if args.count >= 3, args[1] == "--transcribe" {
    let sem = DispatchSemaphore(value: 0)
    Task {
        let s = try await SpeechStream(timestamps: true)
        let f = try AVAudioFile(forReading: URL(fileURLWithPath: args[2]))
        let buf = AVAudioPCMBuffer(pcmFormat: f.processingFormat, frameCapacity: 4096)!
        while (try? f.read(into: buf)) != nil, buf.frameLength > 0 {
            let copy = AVAudioPCMBuffer(pcmFormat: buf.format, frameCapacity: buf.frameLength)!
            copy.frameLength = buf.frameLength
            memcpy(copy.floatChannelData![0], buf.floatChannelData![0], Int(buf.frameLength) * 4)
            s.feed(copy)
        }
        for seg in await s.finish() { print(String(format: "[%.1f-%.1f] ", seg.start, seg.end) + seg.text) }
        sem.signal()
    }
    sem.wait(); exit(0)
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let voice = Voice()
voice.run()
app.run()
