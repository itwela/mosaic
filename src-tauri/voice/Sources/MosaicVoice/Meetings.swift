import AVFoundation
import CoreAudio
import Foundation

// MARK: - Which apps are using the mic

enum AudioProcesses {
    struct Proc { let id: AudioObjectID; let pid: pid_t; let bundle: String; let input: Bool }

    static func list() -> [Proc] {
        var addr = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyProcessObjectList,
                                              mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
        var size: UInt32 = 0
        guard AudioObjectGetPropertyDataSize(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size) == noErr else { return [] }
        var ids = [AudioObjectID](repeating: 0, count: Int(size) / MemoryLayout<AudioObjectID>.size)
        guard AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size, &ids) == noErr else { return [] }
        return ids.map { id in
            Proc(id: id, pid: get(id, kAudioProcessPropertyPID, pid_t(0)),
                 bundle: string(id, kAudioProcessPropertyBundleID) ?? "",
                 input: get(id, kAudioProcessPropertyIsRunningInput, UInt32(0)) != 0)
        }
    }

    static func objectID(forPID pid: pid_t) -> AudioObjectID? {
        var addr = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyTranslatePIDToProcessObject,
                                              mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
        var p = pid
        var out = AudioObjectID(0)
        var size = UInt32(MemoryLayout<AudioObjectID>.size)
        let err = AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &addr,
                                             UInt32(MemoryLayout<pid_t>.size), &p, &size, &out)
        return err == noErr && out != 0 ? out : nil
    }

    private static func get<T>(_ id: AudioObjectID, _ sel: AudioObjectPropertySelector, _ zero: T) -> T {
        var addr = AudioObjectPropertyAddress(mSelector: sel, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
        var v = zero
        var size = UInt32(MemoryLayout<T>.size)
        _ = AudioObjectGetPropertyData(id, &addr, 0, nil, &size, &v)
        return v
    }

    private static func string(_ id: AudioObjectID, _ sel: AudioObjectPropertySelector) -> String? {
        var addr = AudioObjectPropertyAddress(mSelector: sel, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
        var v: Unmanaged<CFString>?
        var size = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
        guard AudioObjectGetPropertyData(id, &addr, 0, nil, &size, &v) == noErr, let s = v?.takeRetainedValue() else { return nil }
        return s as String
    }
}

/// Meeting apps, by bundle id prefix. Browser helpers count too (Meet, Teams on the web).
enum MeetingApps {
    static let known: [(prefix: String, name: String)] = [
        ("us.zoom.", "Zoom"),
        ("com.microsoft.teams", "Teams"),
        ("com.apple.FaceTime", "FaceTime"),
        ("com.apple.avconferenced", "FaceTime"),
        ("com.tinyspeck.slackmacgap", "Slack"),
        ("com.hnc.Discord", "Discord"),
        ("Cisco-Systems.Spark", "Webex"),
        ("com.cisco.webexmeetingsapp", "Webex"),
        ("com.google.Chrome", "Chrome"),
        ("com.apple.Safari", "Safari"),
        ("com.apple.WebKit", "Safari"),
        ("company.thebrowser", "Arc"),
        ("com.brave.Browser", "Brave"),
        ("com.microsoft.edgemac", "Edge"),
        ("org.mozilla.firefox", "Firefox"),
        ("com.openai.chat", "ChatGPT"),
    ]
    static func name(for bundle: String) -> String? {
        known.first { bundle.hasPrefix($0.prefix) }?.name
    }
}

// MARK: - System audio (the other people on the call)

/// Captures what the Mac is playing through a Core Audio process tap. Needs the
/// "System Audio Recording Only" permission. Nothing is written to disk.
final class SystemAudio {
    private var tapID = AudioObjectID(0)
    private var aggID = AudioObjectID(0)
    private var procID: AudioDeviceIOProcID?
    private var format: AVAudioFormat?
    var onBuffer: ((AVAudioPCMBuffer) -> Void)?

    func start() throws {
        var exclude: [AudioObjectID] = []
        if let me = AudioProcesses.objectID(forPID: getpid()) { exclude.append(me) }
        let desc = CATapDescription(monoGlobalTapButExcludeProcesses: exclude)
        desc.uuid = UUID()
        desc.muteBehavior = .unmuted
        desc.isPrivate = true
        var err = AudioHardwareCreateProcessTap(desc, &tapID)
        guard err == noErr else { throw NSError(domain: "voice.tap", code: Int(err)) }

        let agg: [String: Any] = [
            kAudioAggregateDeviceNameKey: "Mosaic meeting notes",
            kAudioAggregateDeviceUIDKey: UUID().uuidString,
            kAudioAggregateDeviceIsPrivateKey: true,
            kAudioAggregateDeviceIsStackedKey: false,
            kAudioAggregateDeviceTapAutoStartKey: true,
            kAudioAggregateDeviceTapListKey: [[kAudioSubTapUIDKey: desc.uuid.uuidString, kAudioSubTapDriftCompensationKey: true]],
        ]
        err = AudioHardwareCreateAggregateDevice(agg as CFDictionary, &aggID)
        guard err == noErr else { stop(); throw NSError(domain: "voice.agg", code: Int(err)) }

        var addr = AudioObjectPropertyAddress(mSelector: kAudioTapPropertyFormat, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
        var asbd = AudioStreamBasicDescription()
        var size = UInt32(MemoryLayout<AudioStreamBasicDescription>.size)
        err = AudioObjectGetPropertyData(tapID, &addr, 0, nil, &size, &asbd)
        guard err == noErr, let fmt = AVAudioFormat(streamDescription: &asbd) else { stop(); throw NSError(domain: "voice.fmt", code: Int(err)) }
        format = fmt

        let queue = DispatchQueue(label: "mosaic.voice.systemaudio")
        err = AudioDeviceCreateIOProcIDWithBlock(&procID, aggID, queue) { [weak self] _, input, _, _, _ in
            guard let self, let fmt = self.format,
                  let buf = AVAudioPCMBuffer(pcmFormat: fmt, bufferListNoCopy: input, deallocator: nil),
                  let copy = AVAudioPCMBuffer(pcmFormat: fmt, frameCapacity: buf.frameLength) else { return }
            copy.frameLength = buf.frameLength
            let bytes = Int(buf.frameLength) * Int(fmt.streamDescription.pointee.mBytesPerFrame)
            for i in 0..<Int(fmt.channelCount) where !fmt.isInterleaved || i == 0 {
                if let s = buf.audioBufferList.pointee.mBuffers.mData, i == 0 {
                    memcpy(copy.audioBufferList.pointee.mBuffers.mData, s, bytes)
                }
            }
            self.onBuffer?(copy)
        }
        guard err == noErr else { stop(); throw NSError(domain: "voice.ioproc", code: Int(err)) }
        err = AudioDeviceStart(aggID, procID)
        guard err == noErr else { stop(); throw NSError(domain: "voice.start", code: Int(err)) }
    }

    func stop() {
        if aggID != 0, let procID { AudioDeviceStop(aggID, procID); AudioDeviceDestroyIOProcID(aggID, procID) }
        procID = nil
        if aggID != 0 { AudioHardwareDestroyAggregateDevice(aggID); aggID = 0 }
        if tapID != 0 { AudioHardwareDestroyProcessTap(tapID); tapID = 0 }
    }
}

struct Line { var speaker: String; var start: Double; var end: Double; var text: String }

// MARK: - Recording a meeting

final class MeetingRecorder {
    let app: String
    let started = Date()
    private let mic = Microphone()
    private let system = SystemAudio()
    private var micStream: SpeechStream?
    private var sysStream: SpeechStream?
    var onLevel: ((Float) -> Void)?

    init(app: String) { self.app = app }

    func start() async throws {
        micStream = try await SpeechStream(timestamps: true)
        sysStream = try await SpeechStream(timestamps: true)
        mic.onBuffer = { [weak self] in self?.micStream?.feed($0) }
        mic.onLevel = { [weak self] in self?.onLevel?($0) }
        try mic.start()
        system.onBuffer = { [weak self] in self?.sysStream?.feed($0) }
        do { try system.start() } catch {
            Events.log("system audio unavailable (\(error)); notes will only have your side")
        }
    }

    /// Stops and returns the transcript (text only) for Mosaic to summarise and save.
    func finish() async -> [String: Any]? {
        mic.stop()
        system.stop()
        let you = await micStream?.finish() ?? []
        let them = await sysStream?.finish() ?? []
        var lines = them.map { Line(speaker: "Them", start: $0.start, end: $0.end, text: $0.text) }
        // Without headphones the mic also hears the other side. Drop "You" lines that repeat a "Them" line.
        for s in you where !Self.isEcho(s, of: them) {
            lines.append(Line(speaker: "You", start: s.start, end: s.end, text: s.text))
        }
        lines.sort { $0.start < $1.start }
        guard !lines.isEmpty else { return nil }

        let ended = Date()
        let iso = ISO8601DateFormatter()
        return [
            "id": UUID().uuidString, "app": app,
            "startedAt": iso.string(from: started), "endedAt": iso.string(from: ended),
            "lines": lines.map { ["speaker": $0.speaker, "start": $0.start, "end": $0.end, "text": $0.text] },
        ]
    }

    func cancel() async {
        mic.stop(); system.stop()
        await micStream?.cancel(); await sysStream?.cancel()
    }

    static func isEcho(_ s: Segment, of others: [Segment]) -> Bool {
        let words = Set(s.text.lowercased().split(whereSeparator: { !$0.isLetter }).map(String.init))
        guard words.count >= 3 else { return false }
        for o in others where abs(o.start - s.start) < 4 || (o.start <= s.end && s.start <= o.end) {
            let ow = Set(o.text.lowercased().split(whereSeparator: { !$0.isLetter }).map(String.init))
            if Double(words.intersection(ow).count) / Double(words.count) > 0.6 { return true }
        }
        return false
    }
}

// MARK: - Noticing meetings

/// Polls every 2 s. When a meeting app has held the mic for 5 s, asks once.
/// Asks again only after that app has let go of the mic for a minute.
final class MeetingWatcher {
    var onMeetingStarted: ((String) -> Void)?
    var onMeetingEnded: (() -> Void)?
    var ignorePIDs: Set<pid_t> = []
    private var timer: Timer?
    private var heldSince: [String: Date] = [:]
    private var releasedAt: [String: Date] = [:]
    private var asked: Set<String> = []
    private(set) var current: String?

    func start() {
        timer = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in self?.tick() }
    }

    private func tick() {
        let me = getpid()
        var using: Set<String> = []
        for p in AudioProcesses.list() where p.input && p.pid != me && !ignorePIDs.contains(p.pid) {
            if let name = MeetingApps.name(for: p.bundle) { using.insert(name) }
        }
        let now = Date()
        for name in using where heldSince[name] == nil { heldSince[name] = now }
        for name in heldSince.keys where !using.contains(name) {
            heldSince[name] = nil
            releasedAt[name] = now
        }
        for (name, at) in releasedAt where now.timeIntervalSince(at) > 60 {
            asked.remove(name); releasedAt[name] = nil
        }
        if let cur = current, !using.contains(cur), let r = releasedAt[cur], now.timeIntervalSince(r) >= 10 {
            current = nil
            onMeetingEnded?()
        }
        guard current == nil else { return }
        for (name, since) in heldSince where now.timeIntervalSince(since) >= 5 && !asked.contains(name) {
            asked.insert(name)
            onMeetingStarted?(name)
            return
        }
    }

    func markRecording(_ app: String) { current = app }
    func clearRecording() { current = nil }
}
