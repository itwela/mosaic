import AVFoundation
import Foundation
import Speech

struct Segment: Codable {
    var start: Double   // seconds from the start of the stream
    var end: Double
    var text: String
}

/// One live stream of audio into Apple's on-device SpeechAnalyzer.
/// Audio buffers go straight from memory into the analyzer and are dropped; nothing is saved.
final class SpeechStream: @unchecked Sendable {
    private let transcriber: SpeechTranscriber
    private let analyzer: SpeechAnalyzer
    private let input: AsyncStream<AnalyzerInput>
    private let continuation: AsyncStream<AnalyzerInput>.Continuation
    private let targetFormat: AVAudioFormat
    private var converter: AVAudioConverter?
    private var converterSource: AVAudioFormat?
    private var results: Task<[Segment], Error>!
    private let lock = NSLock()
    var onSegment: ((Segment) -> Void)?

    static func prepareAssets() async throws {
        let t = SpeechTranscriber(locale: Locale(identifier: "en-US"), preset: .transcription)
        if let req = try await AssetInventory.assetInstallationRequest(supporting: [t]) {
            try await req.downloadAndInstall()
        }
    }

    init(timestamps: Bool) async throws {
        // Same settings as the benchmark that beat Whisper and Parakeet on your own clips.
        transcriber = SpeechTranscriber(
            locale: Locale(identifier: "en-US"),
            transcriptionOptions: [],
            reportingOptions: [],
            attributeOptions: timestamps ? [.audioTimeRange] : [])
        analyzer = SpeechAnalyzer(modules: [transcriber],
                                  options: .init(priority: .userInitiated, modelRetention: .processLifetime))
        guard let fmt = await SpeechAnalyzer.bestAvailableAudioFormat(compatibleWith: [transcriber]) else {
            throw NSError(domain: "voice", code: 1, userInfo: [NSLocalizedDescriptionKey: "No speech audio format"])
        }
        targetFormat = fmt
        (input, continuation) = AsyncStream<AnalyzerInput>.makeStream()

        let context = AnalysisContext()
        context.contextualStrings[.general] = Vocabulary.load()
        try? await analyzer.setContext(context)

        let transcriber = self.transcriber
        results = Task { [weak self] in
            var out: [Segment] = []
            for try await r in transcriber.results where r.isFinal {
                let text = String(r.text.characters).trimmingCharacters(in: .whitespacesAndNewlines)
                if text.isEmpty { continue }
                let seg = Segment(start: r.range.start.seconds.isFinite ? r.range.start.seconds : 0,
                                  end: r.range.end.seconds.isFinite ? r.range.end.seconds : 0,
                                  text: text)
                out.append(seg)
                self?.onSegment?(seg)
            }
            return out
        }
        try await analyzer.start(inputSequence: input)
    }

    /// Feed a buffer in any format; it is converted to what the analyzer wants.
    func feed(_ buffer: AVAudioPCMBuffer) {
        lock.lock(); defer { lock.unlock() }
        if buffer.format == targetFormat {
            continuation.yield(AnalyzerInput(buffer: buffer)); return
        }
        if converter == nil || converterSource != buffer.format {
            converter = AVAudioConverter(from: buffer.format, to: targetFormat)
            converterSource = buffer.format
        }
        guard let converter else { return }
        let ratio = targetFormat.sampleRate / buffer.format.sampleRate
        let capacity = AVAudioFrameCount(Double(buffer.frameLength) * ratio + 64)
        guard let out = AVAudioPCMBuffer(pcmFormat: targetFormat, frameCapacity: capacity) else { return }
        var consumed = false
        var error: NSError?
        converter.convert(to: out, error: &error) { _, status in
            if consumed { status.pointee = .noDataNow; return nil }
            consumed = true; status.pointee = .haveData; return buffer
        }
        if error == nil, out.frameLength > 0 { continuation.yield(AnalyzerInput(buffer: out)) }
    }

    /// Stop listening and return everything that was said.
    func finish() async -> [Segment] {
        continuation.finish()
        try? await analyzer.finalizeAndFinishThroughEndOfInput()
        return (try? await results.value) ?? []
    }

    func cancel() async {
        continuation.finish()
        await analyzer.cancelAndFinishNow()
        results.cancel()
    }
}

/// The microphone, opened only while you talk (the orange dot shows only then).
final class Microphone {
    private let engine = AVAudioEngine()
    var onBuffer: ((AVAudioPCMBuffer) -> Void)?
    var onLevel: ((Float) -> Void)?
    private(set) var running = false

    func start() throws {
        guard !running else { return }
        let node = engine.inputNode
        let format = node.outputFormat(forBus: 0)
        node.removeTap(onBus: 0)
        node.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
            self?.onBuffer?(buffer)
            if let ch = buffer.floatChannelData?[0] {
                var sum: Float = 0
                let n = Int(buffer.frameLength)
                for i in 0..<n { sum += ch[i] * ch[i] }
                let rms = sqrt(sum / Float(max(n, 1)))
                // speech sits around -40..-10 dBFS; map to 0...1
                let db = 20 * log10(max(rms, 1e-6))
                self?.onLevel?(max(0, min(1, (db + 50) / 40)))
            }
        }
        engine.prepare()
        try engine.start()
        running = true
    }

    func stop() {
        guard running else { return }
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
        running = false
    }
}
