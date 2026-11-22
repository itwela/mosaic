import Foundation

/// Where Mosaic Voice keeps its files. Only text and one model live here; audio is never written to disk.
enum Paths {
    static let root: URL = {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        let url = base.appendingPathComponent("com.itwelaibomu.mosaic/voice", isDirectory: true)
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }()
    /// Words the speech engine and the cleanup step should spell this way (names, products).
    static let vocabulary = root.appendingPathComponent("vocabulary.txt")
}

/// Line-delimited JSON to Mosaic on stdout.
enum Events {
    private static let lock = NSLock()
    static func send(_ type: String, _ fields: [String: Any] = [:]) {
        var obj = fields
        obj["type"] = type
        guard let data = try? JSONSerialization.data(withJSONObject: obj),
              var line = String(data: data, encoding: .utf8) else { return }
        line += "\n"
        lock.lock(); defer { lock.unlock() }
        FileHandle.standardOutput.write(line.data(using: .utf8)!)
    }
    /// Also kept in voice/voice.log (trimmed to the last ~200 KB) so problems can be checked later.
    static func log(_ message: String) {
        let line = "\(ISO8601DateFormatter().string(from: Date())) \(message)\n"
        FileHandle.standardError.write(line.data(using: .utf8)!)
        let url = Paths.root.appendingPathComponent("voice.log")
        if let h = try? FileHandle(forWritingTo: url) {
            h.seekToEndOfFile(); h.write(line.data(using: .utf8)!)
            if h.offsetInFile > 400_000 { h.truncateFile(atOffset: 0) }
            try? h.close()
        } else { try? line.write(to: url, atomically: true, encoding: .utf8) }
    }
}

enum Vocabulary {
    static let defaults = ["Mosaic", "FigCraft", "JobKompass", "Claude", "Codex", "Wispr", "Itwela", "Itwela Ibomu"]
    static func load() -> [String] {
        guard let text = try? String(contentsOf: Paths.vocabulary, encoding: .utf8) else {
            try? defaults.joined(separator: "\n").write(to: Paths.vocabulary, atomically: true, encoding: .utf8)
            return defaults
        }
        return text.split(separator: "\n").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
    }
}

/// Round trips to Mosaic's core (cleanup model, meeting summaries).
final class Bridge: @unchecked Sendable {
    static let shared = Bridge()
    private let lock = NSLock()
    private var next = 0
    private var waiting: [Int: CheckedContinuation<String, Never>] = [:]
    private var meetings: [String: CheckedContinuation<(id: String, title: String, minutes: Int)?, Never>] = [:]

    /// Ask Mosaic to clean up a dictation. Falls back to the raw words after 10 s.
    func cleanup(_ raw: String) async -> String {
        lock.lock(); next += 1; let id = next; lock.unlock()
        return await withCheckedContinuation { c in
            lock.lock(); waiting[id] = c; lock.unlock()
            Events.send("dictation-raw", ["id": id, "text": raw])
            DispatchQueue.global().asyncAfter(deadline: .now() + 10) { self.answer(id: id, text: raw) }
        }
    }

    func answer(id: Int, text: String) {
        lock.lock(); let c = waiting.removeValue(forKey: id); lock.unlock()
        c?.resume(returning: text)
    }

    func waitForMeeting(_ id: String) async -> (id: String, title: String, minutes: Int)? {
        await withCheckedContinuation { c in
            lock.lock(); meetings[id] = c; lock.unlock()
            DispatchQueue.global().asyncAfter(deadline: .now() + 600) { self.meetingSaved(["id": id, "failed": true]) }
        }
    }

    func meetingSaved(_ obj: [String: Any]) {
        guard let id = obj["id"] as? String else { return }
        lock.lock(); let c = meetings.removeValue(forKey: id); lock.unlock()
        if obj["failed"] as? Bool == true { c?.resume(returning: nil); return }
        c?.resume(returning: (id, obj["title"] as? String ?? "Meeting", obj["minutes"] as? Int ?? 1))
    }
}
